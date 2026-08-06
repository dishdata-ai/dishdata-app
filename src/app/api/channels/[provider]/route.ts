import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { adapterFor, isChannelProvider, matchRecipeId } from "@/lib/channels";
import type { ChannelOrderLine } from "@/lib/api/database.types";

// Signatures are computed over the exact request bytes, so the body must be
// read raw and never re-serialized.
export const runtime = "nodejs";

/**
 * POST /api/channels/{wolt|ubereats|lieferando}?store=<platform store id>
 *
 * The single inbound door for delivery-platform orders. Verifies the
 * platform's signature, normalizes the payload, stores it in the unified
 * inbox, and — when the channel is set to auto-accept — turns it straight
 * into a real order.
 *
 * Always returns 200 once the payload is safely persisted, even if parsing
 * failed: these platforms retry hard on non-2xx and a redelivery loop is worse
 * than a row marked `failed` that staff can see and replay.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params;
  if (!isChannelProvider(provider)) {
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

  // --- Parse. A failure is recorded, not dropped. --------------------------
  let parsed;
  try {
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

    return NextResponse.json({ received: true, parsed: false, error: message });
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

  if (existing) {
    return NextResponse.json({
      received: true,
      deduped: true,
      channel_order_id: existing.id,
      status: existing.status,
    });
  }

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
    if (insErr.code === "23505") {
      return NextResponse.json({ received: true, deduped: true });
    }
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
      return NextResponse.json({
        received: true, channel_order_id: inserted.id,
        auto_accepted: false, error: accErr.message,
      });
    }
    return NextResponse.json({
      received: true, channel_order_id: inserted.id,
      auto_accepted: true, order: accepted,
    });
  }

  return NextResponse.json({
    received: true,
    channel_order_id: inserted.id,
    status: "pending",
    unmapped_lines: items.filter((i) => !i.recipe_id).length,
  });
}
