import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { adapterFor, isWebhookProvider, matchRecipeId, type WebhookProvider } from "@/lib/channels";
import { getToken, fetchOrder, ackOrder, type PlatformCredentials } from "@/lib/channels/platform-api";
import type { ChannelOrderLine } from "@/lib/api/database.types";

// Signatures are computed over the exact request bytes, so the body must be
// read raw and never re-serialized.
export const runtime = "nodejs";

/**
 * Both Wolt and Uber send a notification carrying only an order id; the order
 * itself has to be fetched with an authenticated GET.
 */
async function resolveOrder(
  admin: SupabaseClient,
  provider: WebhookProvider,
  channelId: string,
  url: string,
): Promise<unknown> {
  const { data: row } = await admin
    .from("channels")
    .select("credentials")
    .eq("id", channelId)
    .single();
  const creds = (row?.credentials ?? {}) as PlatformCredentials;
  const token = await getToken(admin, provider, channelId, creds);
  return fetchOrder(url, token);
}

/**
 * POST /api/channels/{wolt|ubereats|lieferando}?store=<platform store id>
 *
 * The single inbound door for delivery-platform orders. Verifies the
 * platform's signature, normalizes the payload, stores it in the unified
 * inbox, and — when the channel is set to auto-accept — turns it straight
 * into a real order.
 *
 * Always returns 200 with an EMPTY body once the payload is safely persisted,
 * even if parsing failed: Uber and Wolt both require a bare 200 to stop
 * retrying (Uber backs off 7 times, Wolt 3), and a redelivery loop is worse
 * than a row marked `failed` that staff can see and replay.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  // SumUp is pulled by /api/channels/sync, never pushed here.
  if (!isWebhookProvider(provider)) {
    return NextResponse.json({ error: "Unknown channel provider." }, { status: 404 });
  }
  const adapter = adapterFor(provider);

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 503 });

  const raw = await req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON." }, { status: 400 });
  }

  // Route to a channel: the platform's store id identifies which org this is.
  // `?store=` is a fallback for platforms whose payload omits it.
  const storeId = adapter.storeIdOf(payload) || (req.nextUrl.searchParams.get("store") ?? "");
  if (!storeId) {
    return NextResponse.json(
      { error: "Payload carries no store id and none was supplied as ?store=." },
      { status: 400 },
    );
  }

  const { data: channel, error: chErr } = await admin
    .from("channels")
    .select("id, org_id, provider, webhook_secret, is_active, auto_accept")
    .eq("provider", provider)
    .eq("external_store_id", storeId)
    .maybeSingle();

  if (chErr) return NextResponse.json({ error: chErr.message }, { status: 500 });
  if (!channel) {
    return NextResponse.json(
      { error: `No ${provider} channel is connected for store ${storeId}.` },
      { status: 404 },
    );
  }

  // Verify BEFORE trusting anything else in the body.
  const bad = adapter.verify({ raw, headers: req.headers, secret: channel.webhook_secret });
  if (bad) return NextResponse.json({ error: bad }, { status: 401 });

  if (!channel.is_active) {
    return NextResponse.json({ error: "Channel is paused." }, { status: 409 });
  }

  // Both platforms deliver status changes, courier updates and venue alerts to
  // this same endpoint. Acknowledge them so they stop retrying, but never let
  // them create a ticket.
  if (!adapter.isNewOrder(payload)) {
    return new NextResponse(null, { status: 200 });
  }

  // --- Resolve + parse. A failure is recorded, not dropped. ----------------
  let parsed;
  try {
    // Notification-only: fetch the real order before parsing.
    const fetchUrl = adapter.fetchUrlOf(payload);
    if (fetchUrl) payload = await resolveOrder(admin, provider, channel.id, fetchUrl);
    parsed = adapter.parse(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not parse payload.";
    await admin.from("channels").update({
      last_error: message,
      last_error_at: new Date().toISOString(),
    }).eq("id", channel.id);

    // Keep the payload so it can be replayed once the mapping is fixed. The
    // external id may be unknown here, so fall back to a time-based key.
    await admin.from("channel_orders").upsert({
      org_id: channel.org_id,
      channel_id: channel.id,
      provider,
      external_id: `unparsed-${Date.now()}`,
      status: "failed",
      raw: payload as Record<string, unknown>,
      reject_reason: message,
    }, { onConflict: "org_id,provider,external_id", ignoreDuplicates: true });

    return new NextResponse(null, { status: 200 });
  }

  // --- Map lines to recipes so accepting can deplete stock. ----------------
  const { data: recipes } = await admin
    .from("recipes")
    .select("id, name")
    .eq("org_id", channel.org_id)
    .eq("is_active", true);

  const items: ChannelOrderLine[] = parsed.lines.map((l) => ({
    name: l.name,
    qty: l.qty,
    price: l.price,
    recipe_id: matchRecipeId(l.name, recipes ?? []),
    notes: l.notes ?? null,
  }));

  // --- Idempotent insert. Platform retries land on the unique key. ---------
  const { data: existing } = await admin
    .from("channel_orders")
    .select("id, status, order_id")
    .eq("org_id", channel.org_id)
    .eq("provider", provider)
    .eq("external_id", parsed.externalId)
    .maybeSingle();

  if (existing) return new NextResponse(null, { status: 200 });

  const { data: inserted, error: insErr } = await admin
    .from("channel_orders")
    .insert({
      org_id: channel.org_id,
      channel_id: channel.id,
      provider,
      external_id: parsed.externalId,
      external_display_id: parsed.displayId,
      status: "pending",
      items,
      gross: parsed.gross,
      customer_name: parsed.customerName,
      order_type: parsed.orderType,
      notes: parsed.notes,
      fulfillment: parsed.fulfillment,
      raw: payload as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (insErr) {
    // A concurrent retry can win the race on the unique key — that is success.
    if (insErr.code === "23505") return new NextResponse(null, { status: 200 });
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await admin.from("channels").update({
    last_order_at: new Date().toISOString(),
    last_error: null,
  }).eq("id", channel.id);

  // --- Auto-accept, when the channel is configured for it. -----------------
  if (channel.auto_accept) {
    const { data: accepted, error: accErr } = await admin.rpc("accept_channel_order", {
      _channel_order: inserted.id,
      _secret: channel.webhook_secret,
    });
    if (accErr) {
      // The order is safely in the inbox; staff can still accept it manually.
      await admin.from("channels").update({
        last_error: `Auto-accept failed: ${accErr.message}`,
        last_error_at: new Date().toISOString(),
      }).eq("id", channel.id);
      return new NextResponse(null, { status: 200 });
    }
    // Confirm on the platform too — Uber auto-cancels an unanswered order
    // after ~11.5 minutes no matter what our side thinks.
    try {
      const { data: full } = await admin
        .from("channels")
        .select("credentials, prep_minutes")
        .eq("id", channel.id)
        .single();
      const creds = (full?.credentials ?? {}) as PlatformCredentials;
      const token = await getToken(admin, provider, channel.id, creds);
      await ackOrder({
        provider, externalId: parsed.externalId, token, accept: true,
        prepMinutes: full?.prep_minutes ?? undefined,
        reference: (accepted as { order_number?: string } | null)?.order_number,
        environment: creds.environment,
      });
    } catch (e) {
      await admin.from("channels").update({
        last_error: `Accepted locally but not on the platform: ${
          e instanceof Error ? e.message : "unknown"
        }`,
        last_error_at: new Date().toISOString(),
      }).eq("id", channel.id);
    }
    return new NextResponse(null, { status: 200 });
  }

  return new NextResponse(null, { status: 200 });
}
