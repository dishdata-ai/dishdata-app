import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { markOrderPaid } from "@/lib/payments/mark-paid";

// Stripe needs the raw body to verify the signature.
export const runtime = "nodejs";

/**
 * POST /api/payments/direct-webhook?org=<orgId>
 * Webhook of a restaurant that uses its OWN Stripe account (direct mode). Each restaurant
 * creates a webhook in its Stripe dashboard pointing here with its org id, and Stripe signs
 * events with that restaurant's signing secret (stored in org_payment_secrets). Handles
 * checkout.session.completed and marks the order paid, exactly like the Connect webhook.
 */
export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("org") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return NextResponse.json({ error: "Unknown restaurant." }, { status: 400 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  const { data: sec } = await admin.from("org_payment_secrets").select("stripe_secret_key, stripe_webhook_secret").eq("org_id", orgId).maybeSingle();
  if (!sec?.stripe_webhook_secret || !sec.stripe_secret_key) return NextResponse.json({ error: "Webhook not configured." }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = new Stripe(sec.stripe_secret_key).webhooks.constructEvent(raw, sig, sec.stripe_webhook_secret);
  } catch (e) {
    return NextResponse.json({ error: `Signature verification failed: ${e instanceof Error ? e.message : "unknown"}` }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") return NextResponse.json({ received: true });
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return NextResponse.json({ received: true });
  // The order must belong to the restaurant whose webhook this is.
  if (session.metadata?.org_id !== orgId) return NextResponse.json({ error: "Order does not belong to this restaurant." }, { status: 400 });

  const r = await markOrderPaid(admin, {
    orgId,
    orderId: session.metadata?.order_id ?? "",
    lang: session.metadata?.lang,
    amount: (session.amount_total ?? 0) / 100,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
  });
  return NextResponse.json(r.body, { status: r.status });
}
