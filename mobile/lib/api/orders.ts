import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { Order, OrderLine, KitchenStatus, PaymentMethod } from "@/lib/types";

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

export interface NewOrderInput {
  items: OrderLine[];
  tip: number;
  table_id: string | null;
  /** When set, the order is created already paid and a payment row is recorded. */
  payment_method?: PaymentMethod | null;
}

export async function createOrder(orgId: string, input: NewOrderInput): Promise<Order> {
  const subtotal = input.items.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = +(subtotal * (demo.org.tax_rate / 100)).toFixed(2);
  const total = +(subtotal + tax + input.tip).toFixed(2);
  const paid = Boolean(input.payment_method);

  if (!isSupabaseConfigured) {
    const order: Order = {
      id: uid(),
      org_id: orgId,
      order_number: `A-${100 + demo.orders.length + 1}`,
      order_type: "dine_in",
      table_id: input.table_id,
      customer_id: null,
      guest_name: null,
      items: input.items,
      subtotal,
      tax,
      tip: input.tip,
      total,
      status: paid ? "paid" : "open",
      kitchen_status: "new",
      kitchen_notes: null,
      source: "pos",
      created_at: new Date().toISOString(),
    };
    demo.orders.unshift(order);
    if (paid) {
      demo.payments.unshift({
        id: uid(),
        org_id: orgId,
        order_id: order.id,
        method: input.payment_method!,
        amount: total,
        tip_amount: input.tip,
        split_label: null,
        created_at: new Date().toISOString(),
      });
    }
    return order;
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("orders")
    .insert({
      org_id: orgId,
      order_type: "dine_in",
      table_id: input.table_id,
      items: input.items,
      subtotal,
      tax,
      tip: input.tip,
      total,
      status: paid ? "paid" : "open",
      kitchen_status: "new",
      source: "pos",
    })
    .select("*")
    .single();
  if (error) throw error;
  const order = data as Order;
  if (paid) {
    await sb.from("payments").insert({
      org_id: orgId,
      order_id: order.id,
      method: input.payment_method,
      amount: total,
      tip_amount: input.tip,
    });
  }
  return order;
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
