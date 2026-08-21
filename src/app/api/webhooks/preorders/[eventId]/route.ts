import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import {
  buildOrderFromFields,
  normalizeFulfillment,
  parseRequestedDate,
  parseTimeslot,
} from "@/lib/api/preorders";

// Runs with the service-role key, so it must never run at the edge.
export const runtime = "nodejs";

/**
 * POST /api/webhooks/preorders/:eventId?secret=...
 *
 * Receives one preorder from the restaurant's website form. The WordPress side
 * is a small snippet we control, so the body is our own flat contract rather
 * than the form plugin's native payload — the field mapping happens there,
 * where the field labels live, instead of being hardcoded here.
 *
 * Auth is a per-event shared secret rather than a signature: the events are
 * self-service (staff create one and paste its URL into the site), so there's
 * no place to provision a signing key per event. The secret is high-entropy,
 * carried over TLS, and rotatable by regenerating it on the event.
 *
 * Idempotent on (event_id, external_id) — a retried or redelivered submission
 * updates the existing row instead of double-booking the seats.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  const { data: event, error: eventErr } = await admin
    .from("preorder_events")
    .select("id, org_id, is_active, slot_minutes, webhook_secret")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) return NextResponse.json({ error: eventErr.message }, { status: 500 });
  if (!event) return NextResponse.json({ error: "Unknown event." }, { status: 404 });

  // Constant-time-ish compare: reject on length first, then whole-string.
  const supplied = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (supplied.length !== event.webhook_secret.length || supplied !== event.webhook_secret) {
    return NextResponse.json({ error: "Invalid secret." }, { status: 401 });
  }

  if (!event.is_active) {
    // Accept but don't record — a closed campaign shouldn't 500 the website.
    return NextResponse.json({ received: true, ignored: "Event is not active." });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const str = (k: string): string => {
    const v = body[k];
    return v === null || v === undefined ? "" : String(v).trim();
  };
  const num = (k: string): number => {
    const n = Number(String(body[k] ?? "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  // Without a stable id we can't dedupe, and a retry would double-book seats.
  const externalId = str("external_id") || str("submission_id");
  if (!externalId) {
    return NextResponse.json({ error: "Missing external_id." }, { status: 400 });
  }

  // Two shapes are accepted. The WordPress snippet sends our flat contract,
  // having done the label mapping itself. The mailbox forwarder can't map
  // reliably — it only sees the form's own field labels — so it sends those
  // verbatim under `fields` and lets the shared mapper here do the work, which
  // keeps one definition of "what "Dine-in" means" for every intake route.
  if (body.fields && typeof body.fields === "object") {
    const raw = body.fields as Record<string, unknown>;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      fields[k] = v === null || v === undefined ? "" : String(v);
    }

    const { row, error } = buildOrderFromFields(fields);
    if (error || !row) {
      return NextResponse.json({ error: `Couldn't read the submission: ${error}.` }, { status: 400 });
    }

    const { error: upsertErr } = await admin.from("preorder_orders").upsert(
      {
        org_id: event.org_id,
        event_id: event.id,
        external_id: externalId,
        ...row,
        timeslot_end: row.fulfillment_type === "dine_in" ? row.timeslot_end : null,
        raw: body,
      },
      { onConflict: "event_id,external_id" },
    );
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    return NextResponse.json({ received: true, guest: row.customer_name, date: row.requested_date });
  }

  const requestedDate = parseRequestedDate(str("requested_date"));
  if (!requestedDate) {
    return NextResponse.json(
      { error: `Missing or unreadable requested_date: "${str("requested_date")}".` },
      { status: 400 },
    );
  }

  const quantity = Math.max(1, Math.round(num("quantity")));
  const fulfillment = normalizeFulfillment(str("fulfillment_type"));

  // Accept either a pre-split start/end or the raw form value ("14-15").
  const slot = str("timeslot")
    ? parseTimeslot(str("timeslot"))
    : { start: str("timeslot_start") || null, end: str("timeslot_end") || null };

  const { error } = await admin.from("preorder_orders").upsert(
    {
      org_id: event.org_id,
      event_id: event.id,
      external_id: externalId,
      customer_name: str("customer_name"),
      customer_email: str("customer_email") || null,
      customer_phone: str("customer_phone") || null,
      requested_date: requestedDate,
      quantity,
      fulfillment_type: fulfillment,
      timeslot_start: slot.start,
      // A takeaway pickup time occupies no seating window.
      timeslot_end: fulfillment === "dine_in" ? slot.end : null,
      address_street: str("address_street") || null,
      address_apartment: str("address_apartment") || null,
      address_city: str("address_city") || null,
      address_zip: str("address_zip") || null,
      addon_qty: Math.max(0, Math.round(num("addon_qty"))),
      special_requests: str("special_requests") || null,
      order_total: num("order_total"),
      raw: body,
    },
    { onConflict: "event_id,external_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ received: true });
}
