import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoAudit, pushDemoNotification } from "@/lib/api/notifications";
import type {
  Order,
  OrderLine,
  OrderType,
  OrderStatus,
  Payment,
  PaymentMethod,
  KitchenStatus,
  Org,
  RecipeIngredient,
  InventoryItem,
  InventoryTransaction,
  Customer,
  Delivery,
} from "@/lib/api/database.types";

const dOrders = demoTable<Order>("orders");
const dPayments = demoTable<Payment>("payments");
const dOrgs = demoTable<Org>("orgs");
const dIngredients = demoTable<RecipeIngredient>("recipe_ingredients");
const dItems = demoTable<InventoryItem>("inventory_items");
const dTx = demoTable<InventoryTransaction>("inventory_transactions");
const dCustomers = demoTable<Customer>("customers");

export async function listOrders(orgId: string, limit = 500): Promise<Order[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dOrders
      .list({ org_id: orgId } as Partial<Order>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listPayments(orgId: string, limit = 500): Promise<Payment[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPayments
      .list({ org_id: orgId } as Partial<Payment>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("payments")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface CheckoutPayload {
  items: OrderLine[];
  orderType: OrderType;
  tableId?: string | null;
  customerId?: string | null;
  kitchenNotes?: string | null;
  tip?: number;
  /** Delivery address — required when orderType is "delivery". */
  address?: string | null;
  payments: { method: PaymentMethod; amount: number; tip_amount?: number; split_label?: string }[];
}

export interface CheckoutResult {
  order_id: string;
  order_number: string;
  total: number;
}

/** The live-data engine: order + payments + inventory depletion + loyalty, atomically. */
export async function checkoutOrder(orgId: string, payload: CheckoutPayload): Promise<CheckoutResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.get(orgId);
    const taxRate = org?.tax_rate ?? 8.5;
    // VAT-included (gross) pricing: menu prices already include VAT. Break it out
    // of the price rather than adding on top; store subtotal NET (see 0017 migration).
    const gross = payload.items.reduce((s, l) => s + l.price * l.qty, 0);
    const tax = +(gross * (taxRate / (100 + taxRate))).toFixed(2);
    const tip = payload.tip ?? 0;
    const total = +(gross + tip).toFixed(2);
    const subtotal = +(gross - tax).toFixed(2);
    const orderNumber = `ORD-${String(dOrders.list({ org_id: orgId } as Partial<Order>).length + 1).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const order: Order = {
      id: uid(), org_id: orgId, order_number: orderNumber, order_type: payload.orderType,
      table_id: payload.tableId ?? null, customer_id: payload.customerId ?? null, guest_name: null,
      items: payload.items, subtotal, tax, tip, total,
      status: payload.payments.length > 0 ? "paid" : "open",
      kitchen_status: "new", kitchen_notes: payload.kitchenNotes ?? null, source: "pos", created_at: now,
    };
    dOrders.insert(order);
    for (const p of payload.payments) {
      dPayments.insert({
        id: uid(), org_id: orgId, order_id: order.id, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null, created_at: now,
      });
    }
    // Inventory depletion via linked ingredients
    const usage = new Map<string, { used: number; name: string }>();
    for (const line of payload.items) {
      for (const ing of dIngredients.list({ recipe_id: line.recipe_id } as Partial<RecipeIngredient>)) {
        if (!ing.inventory_item_id || ing.qty_numeric <= 0) continue;
        const prev = usage.get(ing.inventory_item_id) ?? { used: 0, name: ing.name };
        prev.used += ing.qty_numeric * line.qty;
        usage.set(ing.inventory_item_id, prev);
      }
    }
    for (const [itemId, u] of usage) {
      const item = dItems.get(itemId);
      if (!item) continue;
      const newStock = Math.max(0, +(item.stock - u.used).toFixed(3));
      dItems.update(itemId, { stock: newStock });
      dTx.insert({
        id: uid(), org_id: orgId, item_id: itemId, item_name: item.name, delta: -u.used,
        reason: "sale", waste_reason: null, ref_order_id: order.id, note: null, created_at: now,
      });
      if (newStock < item.par_level * 0.5 && item.stock >= item.par_level * 0.5) {
        pushDemoNotification(
          orgId, "low_stock", `Low stock: ${item.name}`,
          `Only ${newStock} ${item.unit} left (par ${item.par_level})`, "inventory",
        );
      }
    }
    pushDemoAudit(orgId, "orders", "INSERT", order.id, { order_number: orderNumber });
    // Table + delivery side effects
    if (payload.tableId) {
      demoTable<{ id: string; status: string }>("restaurant_tables").update(payload.tableId, { status: "seated" });
    }
    if (payload.orderType === "delivery") {
      demoTable<Delivery>("deliveries").insert({
        id: uid(), org_id: orgId, order_id: order.id, courier_employee_id: null,
        address: payload.address ?? "", phone: null, status: "pending", eta: null,
        notes: null, created_at: now, updated_at: now, created_by: null,
        postcode: null, delivery_fee: 0, current_lat: null, current_lng: null,
        location_updated_at: null,
      });
    }
    // Loyalty
    if (payload.customerId) {
      const c = dCustomers.get(payload.customerId);
      if (c) {
        const newSpend = c.total_spend + total;
        dCustomers.update(c.id, {
          visits: c.visits + 1,
          total_spend: +newSpend.toFixed(2),
          points: c.points + Math.floor(total),
          last_visit_at: now,
          tier: newSpend >= 2000 ? "Platinum" : newSpend >= 1000 ? "Gold" : newSpend >= 400 ? "Silver" : "Bronze",
        });
      }
    }
    return { order_id: order.id, order_number: orderNumber, total };
  }

  const { data, error } = await getSupabase().rpc("checkout_order", {
    _org: orgId,
    _items: payload.items,
    _order_type: payload.orderType,
    _table_id: payload.tableId ?? null,
    _customer_id: payload.customerId ?? null,
    _kitchen_notes: payload.kitchenNotes ?? null,
    _tip: payload.tip ?? 0,
    _payments: payload.payments,
    _address: payload.address ?? null,
  });
  if (error) throw error;
  return data as CheckoutResult;
}

/**
 * Change an order's status — used to Void (cancel/mis-ring) or Refund a paid
 * order. The record is kept (never deleted), so history and audit stay intact;
 * void/refunded orders are simply excluded from takings and revenue reports.
 */
export async function setOrderStatus(
  orgId: string,
  orderId: string,
  status: OrderStatus,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(orderId, { status });
    pushDemoAudit(orgId, "orders", "UPDATE", orderId, { status });
    return;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function setKitchenStatus(orgId: string, orderId: string, status: KitchenStatus): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(orderId, { kitchen_status: status });
    return;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ kitchen_status: status })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/**
 * Settle an open order (e.g. a dine-in tab where the waiter took the order and
 * the guest pays after eating). Records the payment(s) and flips status to paid.
 * Pass `tip` to add a gratuity at settle time — the order's tip/total are
 * updated so Z-reports and analytics stay consistent.
 */
export async function markOrderPaid(
  orgId: string,
  orderId: string,
  payments: CheckoutPayload["payments"],
  tip?: number,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    for (const p of payments) {
      dPayments.insert({
        id: uid(), org_id: orgId, order_id: orderId, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null, created_at: now,
      });
    }
    const order = dOrders.get(orderId);
    const patch: Partial<Order> = { status: "paid" };
    if (tip != null && order) {
      patch.tip = +tip.toFixed(2);
      patch.total = +(order.subtotal + order.tax + tip).toFixed(2);
    }
    dOrders.update(orderId, patch);
    return;
  }
  const sb = getSupabase();
  if (payments.length) {
    const { error } = await sb.from("payments").insert(
      payments.map((p) => ({
        org_id: orgId, order_id: orderId, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null,
      })),
    );
    if (error) throw error;
  }
  const patch: Record<string, unknown> = { status: "paid" };
  if (tip != null) {
    const { data: ord, error: readErr } = await sb
      .from("orders")
      .select("subtotal, tax")
      .eq("id", orderId)
      .eq("org_id", orgId)
      .single();
    if (readErr) throw readErr;
    patch.tip = +tip.toFixed(2);
    patch.total = +((ord?.subtotal ?? 0) + (ord?.tax ?? 0) + tip).toFixed(2);
  }
  const { error } = await sb.from("orders").update(patch).eq("id", orderId).eq("org_id", orgId);
  if (error) throw error;
}
