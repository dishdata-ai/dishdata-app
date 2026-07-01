import { NextResponse, type NextRequest } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { isStripeConfigured } from "@/lib/payments/config";

/**
 * POST /api/payments/terminal/intent
 * Body: { orderId }
 * Creates a card-present PaymentIntent for an existing order on the org's
 * connected account (with the platform fee). The mobile Terminal SDK confirms
 * it via Tap to Pay; the webhook marks the order paid on success.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured on the server." }, { status: 400 });
  }
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org } = res.value;

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.orderId) return NextResponse.json({ error: "orderId is required." }, { status: 400 });

  const settings = readPaymentsSettings(org.settings);
  if (!settings.account_id || !settings.charges_enabled) {
    return NextResponse.json({ error: "This org has not connected Stripe payments." }, { status: 409 });
  }

  // Order must belong to the caller's org (RLS-scoped read) and be unpaid.
  const { data: order, error } = await sb
    .from("orders")
    .select("id, total, status, order_number")
    .eq("id", body.orderId)
    .eq("org_id", org.id)
    .single();
  if (error || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.status === "paid") return NextResponse.json({ error: "Order is already paid." }, { status: 409 });

  const provider = getPaymentProvider(settings);
  if (!provider.createCardPresentIntent) {
    return NextResponse.json({ error: "Provider does not support in-person payments." }, { status: 400 });
  }

  try {
    const intent = await provider.createCardPresentIntent({
      accountId: settings.account_id,
      orgId: org.id,
      orderId: order.id,
      amount: order.total,
      currency: org.currency,
      description: `${org.name} · ${order.order_number}`,
    });
    return NextResponse.json(intent);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create payment intent." },
      { status: 500 },
    );
  }
}
