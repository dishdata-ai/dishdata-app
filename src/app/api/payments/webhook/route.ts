import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/payments/stripe";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { isStripeConfigured } from "@/lib/payments/config";
import { markOrderPaid as markPaid } from "@/lib/payments/mark-paid";
import type { PaidEvent } from "@/lib/payments/mark-paid";

// Stripe requires the raw, unparsed request body to verify the signature.
export const runtime = "nodejs";

async function markOrderPaid(admin: SupabaseClient, e: PaidEvent): Promise<NextResponse> {
  const r = await markPaid(admin, e);
  return NextResponse.json(r.body, { status: r.status });
}

/**
 * POST /api/payments/webhook
 * Verifies the Stripe signature and marks orders paid. Handles:
 *  - checkout.session.completed  → online / QR Checkout (card-not-present)
 *  - payment_intent.succeeded    → in-person Tap to Pay / Terminal (card-present)
 * Configured as a Connect webhook so connected-account events arrive here.
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

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") return NextResponse.json({ received: true });
      return markOrderPaid(admin, {
        orgId: session.metadata?.org_id ?? "",
        orderId: session.metadata?.order_id ?? "",
        lang: session.metadata?.lang,
        amount: (session.amount_total ?? 0) / 100,
        paymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
      });
    }
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      return markOrderPaid(admin, {
        orgId: pi.metadata?.org_id ?? "",
        orderId: pi.metadata?.order_id ?? "",
        amount: (pi.amount_received ?? pi.amount ?? 0) / 100,
        paymentIntentId: pi.id,
      });
    }
    default:
      // Acknowledge unhandled events so Stripe stops retrying.
      return NextResponse.json({ received: true });
  }
}
