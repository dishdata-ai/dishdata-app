import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Delivery, Order } from "@/lib/types";

export interface DeliveryWithOrder extends Delivery {
  order: Pick<Order, "order_number" | "guest_name" | "total" | "items"> | null;
}

function attachOrder(d: Delivery): DeliveryWithOrder {
  const order = demo.orders.find((o) => o.id === d.order_id) ?? null;
  return {
    ...d,
    order: order
      ? { order_number: order.order_number, guest_name: order.guest_name, total: order.total, items: order.items }
      : null,
  };
}

/** Deliveries assigned to this rider, still in progress (not delivered/failed). */
export async function listMyDeliveries(orgId: string, employeeId: string): Promise<DeliveryWithOrder[]> {
  if (!isSupabaseConfigured) {
    return demo.deliveries
      .filter(
        (d) =>
          d.org_id === orgId &&
          d.courier_employee_id === employeeId &&
          (d.status === "assigned" || d.status === "picked_up"),
      )
      .map(attachOrder);
  }
  const { data, error } = await getSupabase()
    .from("deliveries")
    .select("*, orders(order_number, guest_name, total, items)")
    .eq("org_id", orgId)
    .eq("courier_employee_id", employeeId)
    .in("status", ["assigned", "picked_up"])
    .order("created_at");
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, order: row.orders ?? null }));
}

/** Rider taps "Start trip" — flips the delivery to picked_up. Org members
 * already have update rights on `deliveries` (standard org-member policy),
 * no RPC needed for the status field itself — only the location write is
 * narrowly scoped via report_courier_location. */
export async function startTrip(orgId: string, deliveryId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const d = demo.deliveries.find((x) => x.id === deliveryId);
    if (d) {
      d.status = "picked_up";
      d.updated_at = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase()
    .from("deliveries")
    .update({ status: "picked_up" })
    .eq("id", deliveryId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Reports the rider's current position. Calls report_courier_location,
 * which independently verifies the caller is the assigned rider — this
 * function does not (and should not) trust orgId/deliveryId alone. */
export async function reportLocation(deliveryId: string, lat: number, lng: number): Promise<void> {
  if (!isSupabaseConfigured) {
    const d = demo.deliveries.find((x) => x.id === deliveryId);
    if (d) {
      d.current_lat = lat;
      d.current_lng = lng;
      d.location_updated_at = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase().rpc("report_courier_location", {
    _delivery_id: deliveryId,
    _lat: lat,
    _lng: lng,
  });
  if (error) throw error;
}

export async function markDelivered(orgId: string, deliveryId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const d = demo.deliveries.find((x) => x.id === deliveryId);
    if (d) {
      d.status = "delivered";
      d.updated_at = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase()
    .from("deliveries")
    .update({ status: "delivered" })
    .eq("id", deliveryId)
    .eq("org_id", orgId);
  if (error) throw error;
}
