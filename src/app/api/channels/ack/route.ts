import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { getToken, ackOrder, type PlatformCredentials } from "@/lib/channels/platform-api";

export const runtime = "nodejs";

/**
 * POST /api/channels/ack
 * body: { channel_order_id, action: "accept" | "deny", reason?, prep_minutes? }
 *
 * Tells the delivery platform what staff decided in DishData, so the order does
 * not also have to be accepted on the platform's own tablet. Called right after
 * the accept/reject RPC has already updated our side.
 *
 * Authorization: the caller's Supabase access token. We read the channel order
 * through a user-scoped client so RLS decides whether they may act on it — the
 * service-role client is used only afterwards, to read the channel credentials
 * the browser must never see.
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const admin = createSupabaseAdmin();
  if (!url || !anon || !admin) {
    return NextResponse.json({ error: "Backend unavailable." }, { status: 503 });
  }

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    channel_order_id?: string;
    action?: "accept" | "deny";
    reason?: string;
    prep_minutes?: number;
  };
  if (!body.channel_order_id || (body.action !== "accept" && body.action !== "deny")) {
    return NextResponse.json({ error: "channel_order_id and action are required." }, { status: 400 });
  }

  // RLS decides visibility: a user who cannot see this row cannot ack it.
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: co, error: coErr } = await asUser
    .from("channel_orders")
    .select("id, provider, external_id, channel_id")
    .eq("id", body.channel_order_id)
    .maybeSingle();
  if (coErr) return NextResponse.json({ error: coErr.message }, { status: 500 });
  if (!co) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  // Uber and Wolt both need an explicit accept/reject call. Lieferando's
  // partner flow is not public, so it is a no-op rather than a wrong guess.
  if (co.provider !== "ubereats" && co.provider !== "wolt") {
    return NextResponse.json({ acked: false, reason: "No outbound ack for this provider yet." });
  }

  const { data: ch } = await admin
    .from("channels")
    .select("id, credentials, prep_minutes")
    .eq("id", co.channel_id)
    .single();

  try {
    const creds = (ch?.credentials ?? {}) as PlatformCredentials;
    const bearer = await getToken(admin, co.provider, co.channel_id, creds);
    await ackOrder({
      provider: co.provider,
      externalId: co.external_id,
      token: bearer,
      accept: body.action === "accept",
      prepMinutes: body.prep_minutes ?? ch?.prep_minutes ?? undefined,
      reason: body.reason,
    });
    return NextResponse.json({ acked: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Platform acknowledge failed.";
    await admin
      .from("channels")
      .update({ last_error: message, last_error_at: new Date().toISOString() })
      .eq("id", co.channel_id);
    // Our order already exists; surface the failure without undoing it.
    return NextResponse.json({ acked: false, error: message }, { status: 502 });
  }
}
