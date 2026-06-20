import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { isStripeConfigured } from "@/lib/payments/config";

// Stripe requires the raw, unparsed request body to verify the signature.
export const runtime = "nodejs";

/**
 * POST /api/payments/webhook
 * Verifies the Stripe signature and, on a completed Checkout, marks the order
 * paid and records the payment. Configured as a Connect webhook so events from
 * connected accounts (direct charges) are delivered here.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeConfigured() || !secret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `Signature verification failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 400 },
    );
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge unhandled events so Stripe stops retrying.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const orgId = session.metadata?.org_id;
  const orderId = session.metadata?.order_id;
  if (!orgId || !orderId) {
    return NextResponse.json({ error: "Missing order metadata." }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  const amount = (session.amount_total ?? 0) / 100;
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  // Idempotent: skip if a payment for this intent already exists.
  if (paymentIntentId) {
    const { data: existing } = await admin
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (existing) return NextResponse.json({ received: true, deduped: true });
  }

  const { error: payErr } = await admin.from("payments").insert({
    org_id: orgId,
    order_id: orderId,
    method: "stripe",
    amount,
    tip_amount: 0,
    stripe_payment_intent_id: paymentIntentId,
  });
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  const { error: ordErr } = await admin
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });

  return NextResponse.json({ received: true });
}
