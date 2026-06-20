import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { appUrl, isStripeConfigured } from "@/lib/payments/config";

/**
 * POST /api/payments/checkout
 * Body: { orderId, successUrl?, cancelUrl? }
 * Creates a hosted Stripe Checkout for an existing OPEN order, charged on the
 * restaurant's connected account with the platform application fee. The amount
 * is taken from the order row server-side (never trusted from the client).
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured on the server." }, { status: 400 });
  }
  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Payments require a connected Supabase backend." }, { status: 400 });
  }

  let body: { orderId?: string; successUrl?: string; cancelUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, org_id, total, status, order_number")
    .eq("id", body.orderId)
    .single();
  if (orderErr || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.status === "paid") {
    return NextResponse.json({ error: "Order is already paid." }, { status: 409 });
  }

  const { data: org, error: orgErr } = await admin
    .from("orgs")
    .select("id, name, currency, settings")
    .eq("id", order.org_id)
    .single();
  if (orgErr || !org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const settings = readPaymentsSettings(org.settings as Record<string, unknown>);
  if (!settings.account_id || !settings.charges_enabled) {
    return NextResponse.json(
      { error: "This restaurant is not set up to accept online payments yet." },
      { status: 409 },
    );
  }

  try {
    const provider = getPaymentProvider(settings);
    const result = await provider.createCheckout({
      accountId: settings.account_id,
      orgId: org.id,
      orderId: order.id,
      amount: order.total,
      currency: org.currency,
      description: `${org.name} · ${order.order_number}`,
      successUrl: body.successUrl ?? `${appUrl()}/?paid=${order.order_number}`,
      cancelUrl: body.cancelUrl ?? `${appUrl()}/?cancelled=${order.order_number}`,
    });
    return NextResponse.json({ url: result.url, sessionId: result.sessionId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start checkout." },
      { status: 500 },
    );
  }
}
