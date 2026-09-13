import { NextResponse, type NextRequest } from "next/server";
import { authClient } from "@/lib/api-auth";
import { isTseActive, signOrder } from "@/lib/tse";
import type { Order, Org } from "@/lib/api/database.types";

export const runtime = "nodejs";
// Signing adds two round-trips to fiskaly; the default 10s can be tight when
// their API is slow, and timing out mid-checkout is the worst outcome.
export const maxDuration = 60;

/**
 * POST /api/pos/checkout
 *
 * Checkout for restaurants running a TSE. Identical to calling the
 * `checkout_order` RPC directly — which is still what happens without a TSE —
 * except the completed order is then signed by the cloud TSE before the till
 * hears back.
 *
 * WHY THIS EXISTS: signing is an HTTP call to fiskaly, which a Postgres
 * function cannot make. So the order is created first (checkout_order remains
 * the single source of truth for pricing, VAT, discounts, inventory and
 * loyalty), then signed with the amounts it actually recorded. Signing the
 * client's claimed amounts instead would let a modified till sign one figure
 * and store another.
 *
 * A signing failure does NOT fail the sale: under KassenSichV an outage is a
 * defined operating state — the order stands, the failure is logged with a
 * reason, and the receipt must show the signature is missing.
 */
export async function POST(req: NextRequest) {
  const auth = await authClient(req);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { supabase } = auth;

  let body: { org_id?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.org_id || !body.payload) {
    return NextResponse.json({ error: "org_id and payload are required." }, { status: 400 });
  }

  const p = body.payload as {
    items: unknown;
    orderType: string;
    tableId?: string | null;
    customerId?: string | null;
    kitchenNotes?: string | null;
    tip?: number;
    address?: string | null;
    discountAmount?: number;
    discountPct?: number;
    employeeId?: string | null;
    staffDiscountEmployeeId?: string | null;
    approvalPin?: string | null;
    mealPin?: string | null;
    payments: { method: string; amount: number; tip_amount?: number; split_label?: string }[];
  };

  // 1. Create the order. RLS + the RPC's own membership check still apply, and
  //    every limit (staff discount caps, PIN thresholds) is enforced in there.
  const { data, error } = await supabase.rpc("checkout_order", {
    _org: body.org_id,
    _items: p.items,
    _order_type: p.orderType,
    _table_id: p.tableId ?? null,
    _customer_id: p.customerId ?? null,
    _kitchen_notes: p.kitchenNotes ?? null,
    _tip: p.tip ?? 0,
    _payments: p.payments,
    _address: p.address ?? null,
    _discount_amount: p.discountAmount ?? 0,
    _discount_pct: p.discountPct ?? 0,
    _employee_id: p.employeeId ?? null,
    _staff_employee_id: p.staffDiscountEmployeeId ?? null,
    _approval_pin: p.approvalPin ?? null,
    _meal_pin: p.mealPin ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = data as { order_id: string; order_number: string; total: number; discount?: number };

  // 2. Sign it. Only paid orders carry a Kassenbeleg — an open tab is signed
  //    when it's settled, not when the kitchen gets the ticket.
  let tse: { signed: boolean; error?: string } | undefined;
  if (p.payments.length > 0) {
    const { data: org } = await supabase.from("orgs").select("*").eq("id", body.org_id).single();
    if (org && isTseActive(org as Org)) {
      const { data: order } = await supabase
        .from("orders")
        .select("*")
        .eq("id", result.order_id)
        .single();
      if (order) {
        tse = await signOrder(supabase, order as Order, org as Org, p.payments);
      }
    }
  }

  return NextResponse.json({ ...result, ...(tse ? { tse } : {}) });
}
