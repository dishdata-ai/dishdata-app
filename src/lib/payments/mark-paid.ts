import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWebsiteOrder } from "@/lib/notify/orderEmails";

export interface PaidEvent {
  orgId: string;
  orderId: string;
  amount: number;
  paymentIntentId: string | null;
  lang?: string;
}

export type MarkPaidResult = { status: 200; body: Record<string, unknown> } | { status: 400 | 500; body: { error: string } };

/**
 * Record a Stripe payment and flip the order to paid. Idempotent per payment intent.
 * Shared by the Connect webhook and the per-restaurant direct webhook. Website pre-orders wait
 * as 'void' until this runs, so it also confirms the table and sends the order emails.
 */
export async function markOrderPaid(admin: SupabaseClient, e: PaidEvent): Promise<MarkPaidResult> {
  if (!e.orgId || !e.orderId) return { status: 400, body: { error: "Missing order metadata." } };

  if (e.paymentIntentId) {
    const { data: existing } = await admin.from("payments").select("id").eq("stripe_payment_intent_id", e.paymentIntentId).maybeSingle();
    if (existing) return { status: 200, body: { received: true, deduped: true } };
  }

  const { error: payErr } = await admin.from("payments").insert({
    org_id: e.orgId,
    order_id: e.orderId,
    method: "stripe",
    amount: e.amount,
    tip_amount: 0,
    stripe_payment_intent_id: e.paymentIntentId,
  });
  if (payErr) return { status: 500, body: { error: payErr.message } };

  const { error: ordErr } = await admin.from("orders").update({ status: "paid" }).eq("id", e.orderId).eq("org_id", e.orgId);
  if (ordErr) return { status: 500, body: { error: ordErr.message } };

  // A missing function (migration 0075 not applied yet) must not fail the payment record above.
  const { error: confirmErr } = await admin.rpc("confirm_prepaid_order", { _order_id: e.orderId });
  if (confirmErr) console.error("[payments] confirm_prepaid_order failed", confirmErr.message);

  await notifyWebsiteOrder(admin, e.orderId, e.lang).catch((err) => console.error("[payments] order email failed", err));
  return { status: 200, body: { received: true } };
}
