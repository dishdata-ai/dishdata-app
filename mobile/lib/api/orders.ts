import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import { demoPartnerMealUsage, demoStaffMealUsage } from "@/lib/api/meals";
import { priceClaim, type MealClaim } from "@/lib/staff-meal";
import type { Order, OrderLine, KitchenStatus, OrderType, PaymentMethod } from "@/lib/types";

export async function listOpenOrders(orgId: string): Promise<Order[]> {
  if (!isSupabaseConfigured) {
    return demo.orders
      .filter((o) => o.status === "open")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Active kitchen tickets (anything not yet served). */
export async function listKitchenOrders(orgId: string): Promise<Order[]> {
  if (!isSupabaseConfigured) {
    return demo.orders
      .filter((o) => o.kitchen_status !== "served")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("org_id", orgId)
    .neq("kitchen_status", "served")
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  tip_amount?: number;
  split_label?: string;
}

export interface CheckoutPayload {
  items: OrderLine[];
  orderType: OrderType;
  tableId?: string | null;
  customerId?: string | null;
  kitchenNotes?: string | null;
  tip?: number;
  /** Delivery address — used when orderType is "delivery". */
  address?: string | null;
  /**
   * Charge this order to the employee's staff-meal allowance (migration 0048/0070). Needs mealPin — the employee's
   * OWN PIN, confirming it's really them. The server works out the discount; this is only who is claiming.
   */
  staffDiscountEmployeeId?: string | null;
  mealPin?: string | null;
  /** Take one of the signed-in partner's free meals this month. The server checks they are a partner. */
  partnerMeal?: boolean;
  /** Empty array = open a tab (pay later); one or more = paid now. */
  payments: PaymentInput[];
}

export interface CheckoutResult {
  order_id: string;
  order_number: string;
  total: number;
}

/**
 * Checkout the cart: create the order, record any payments, and apply
 * side effects (seat the table, bump loyalty). Mirrors the web checkoutOrder —
 * the Supabase path reuses the same `checkout_order` RPC for parity.
 */
export async function checkoutOrder(
  orgId: string,
  payload: CheckoutPayload,
): Promise<CheckoutResult> {
  const tip = payload.tip ?? 0;

  if (!isSupabaseConfigured) {
    // VAT-included (gross) pricing: menu prices already include VAT. Break it out
    // of the price rather than adding on top; store subtotal NET (see 0017 migration).
    const gross = payload.items.reduce((s, l) => s + l.price * l.qty, 0);
    const taxRate = demo.org.tax_rate ?? 8.5;

    // Meal claims, with the same checks the database makes (the demo has no server to enforce them).
    const claim: MealClaim = payload.partnerMeal ? "partner" : payload.staffDiscountEmployeeId ? "meal" : "none";
    let discount = 0;
    let mealAmount = 0;
    let mealDrinks = 0;
    let partnerAmount = 0;
    if (claim !== "none") {
      const lines = payload.items.map((l) => ({
        price: l.price,
        qty: l.qty,
        category: demo.recipes.find((r) => r.id === l.recipe_id)?.category,
      }));
      if (claim === "meal") {
        if (payload.staffDiscountEmployeeId !== demo.me.id) throw new Error("staff discount: employee not found or inactive");
        if (demo.me.pin == null || demo.me.pin !== payload.mealPin) {
          throw new Error("PIN doesn't match — enter your own PIN to confirm it's you");
        }
        if ((demo.org.staff_meal_daily_limit ?? 0) <= 0) throw new Error("staff meals are not enabled for this restaurant");
        const priced = priceClaim("meal", lines, demoStaffMealUsage(demo.me.id), null);
        discount = priced.discount;
        mealAmount = priced.free;
        mealDrinks = priced.freeDrinks;
      } else {
        const priced = priceClaim("partner", lines, null, demoPartnerMealUsage());
        if (priced.blocked) throw new Error(priced.blocked);
        discount = priced.discount;
        partnerAmount = priced.free;
      }
    }
    const discountedGross = +(gross - discount).toFixed(2);
    const tax = +(discountedGross * (taxRate / (100 + taxRate))).toFixed(2);
    const total = +(discountedGross + tip).toFixed(2);
    const subtotal = +(discountedGross - tax).toFixed(2);

    const now = new Date().toISOString();
    const orderNumber = `ORD-${String(demo.orders.length + 1).padStart(4, "0")}`;
    const order: Order = {
      id: uid(),
      org_id: orgId,
      order_number: orderNumber,
      order_type: payload.orderType,
      table_id: payload.tableId ?? null,
      customer_id: payload.customerId ?? null,
      guest_name: null,
      items: payload.items,
      subtotal,
      tax,
      tip,
      total,
      status: payload.payments.length > 0 ? "paid" : "open",
      kitchen_status: "new",
      kitchen_notes: payload.kitchenNotes ?? null,
      source: "pos",
      created_at: now,
      discount: +discount.toFixed(2),
      staff_discount_employee_id: claim === "meal" ? demo.me.id : null,
      staff_discount_amount: claim === "meal" ? +(discount - mealAmount).toFixed(2) : 0,
      staff_meal_amount: mealAmount,
      staff_meal_drinks: mealDrinks,
      partner_meal_user_id: claim === "partner" ? demo.me.user_id : null,
      partner_meal_amount: partnerAmount,
    };
    demo.orders.unshift(order);
    for (const p of payload.payments) {
      demo.payments.unshift({
        id: uid(),
        org_id: orgId,
        order_id: order.id,
        method: p.method,
        amount: p.amount,
        tip_amount: p.tip_amount ?? 0,
        split_label: p.split_label ?? null,
        created_at: now,
      });
    }
    // Seat the table
    if (payload.tableId) {
      const t = demo.tables.find((x) => x.id === payload.tableId);
      if (t) t.status = "seated";
    }
    // Loyalty bump
    if (payload.customerId) {
      const c = demo.customers.find((x) => x.id === payload.customerId);
      if (c) {
        c.visits += 1;
        c.total_spend = +(c.total_spend + total).toFixed(2);
        c.points += Math.floor(total);
        c.last_visit_at = now;
      }
    }
    return { order_id: order.id, order_number: orderNumber, total };
  }

  const args: Record<string, unknown> = {
    _org: orgId,
    _items: payload.items,
    _order_type: payload.orderType,
    _table_id: payload.tableId ?? null,
    _customer_id: payload.customerId ?? null,
    _kitchen_notes: payload.kitchenNotes ?? null,
    _tip: tip,
    _payments: payload.payments,
    _address: payload.address ?? null,
  };
  // The claim arguments are only sent when there IS a claim, so ordinary checkouts are byte-for-byte what they
  // were — and still work on a database that hasn't had migration 0070 yet.
  if (payload.staffDiscountEmployeeId && payload.mealPin) {
    args._staff_employee_id = payload.staffDiscountEmployeeId;
    args._meal_pin = payload.mealPin;
  }
  if (payload.partnerMeal) args._partner_meal = true;
  const { data, error } = await getSupabase().rpc("checkout_order", args);
  if (error) throw error;
  return data as CheckoutResult;
}

/** Settle an open tab: record payment(s), flip to paid, optionally add a tip. */
export async function markOrderPaid(
  orgId: string,
  orderId: string,
  payments: PaymentInput[],
  tip?: number,
): Promise<void> {
  if (!isSupabaseConfigured) {
    const now = new Date().toISOString();
    for (const p of payments) {
      demo.payments.unshift({
        id: uid(),
        org_id: orgId,
        order_id: orderId,
        method: p.method,
        amount: p.amount,
        tip_amount: p.tip_amount ?? 0,
        split_label: p.split_label ?? null,
        created_at: now,
      });
    }
    const order = demo.orders.find((o) => o.id === orderId);
    if (order) {
      order.status = "paid";
      if (tip != null) {
        order.tip = +tip.toFixed(2);
        order.total = +(order.subtotal + order.tax + tip).toFixed(2);
      }
    }
    return;
  }
  const sb = getSupabase();
  if (payments.length) {
    const { error } = await sb.from("payments").insert(
      payments.map((p) => ({
        org_id: orgId,
        order_id: orderId,
        method: p.method,
        amount: p.amount,
        tip_amount: p.tip_amount ?? 0,
        split_label: p.split_label ?? null,
      })),
    );
    if (error) throw error;
  }
  const patch: Record<string, unknown> = { status: "paid" };
  if (tip != null) {
    const { data: ord } = await sb
      .from("orders")
      .select("subtotal, tax")
      .eq("id", orderId)
      .eq("org_id", orgId)
      .single();
    patch.tip = +tip.toFixed(2);
    patch.total = +((ord?.subtotal ?? 0) + (ord?.tax ?? 0) + tip).toFixed(2);
  }
  const { error } = await sb.from("orders").update(patch).eq("id", orderId).eq("org_id", orgId);
  if (error) throw error;
}

/**
 * Mark one line of a ticket ready (or undo it). The ticket follows its lines: all ready → ready, some ready on a
 * new ticket → preparing, an un-ready line on a ready ticket → back to preparing. Returns the ticket's new status.
 */
export async function setLineReady(
  orgId: string,
  order: Order,
  lineIndex: number,
  ready: boolean,
): Promise<KitchenStatus> {
  const items = order.items.map((l, i) => (i === lineIndex ? { ...l, ready } : l));
  let status = order.kitchen_status;
  if (items.every((l) => l.ready)) status = "ready";
  else if (status === "ready") status = "preparing";
  else if (items.some((l) => l.ready) && status === "new") status = "preparing";
  if (!isSupabaseConfigured) {
    const o = demo.orders.find((x) => x.id === order.id);
    if (o) {
      o.items = items;
      o.kitchen_status = status;
    }
    return status;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ items, kitchen_status: status })
    .eq("id", order.id)
    .eq("org_id", orgId);
  if (error) throw error;
  return status;
}

export async function setKitchenStatus(
  orgId: string,
  orderId: string,
  kitchen_status: KitchenStatus,
): Promise<void> {
  if (!isSupabaseConfigured) {
    const o = demo.orders.find((x) => x.id === orderId);
    if (o) o.kitchen_status = kitchen_status;
    return;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ kitchen_status })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (error) throw error;
}
