import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { KitchenDish, KitchenLogEntry, KitchenLogKind, Order } from "@/lib/types";

export async function listKitchenDishes(orgId: string): Promise<KitchenDish[]> {
  if (!isSupabaseConfigured) return [...demo.kitchenDishes].sort((a, b) => a.position - b.position);
  const { data, error } = await getSupabase()
    .from("kitchen_dishes")
    .select("*")
    .eq("org_id", orgId)
    .order("position")
    .order("dish");
  if (error) throw error;
  return (data ?? []) as KitchenDish[];
}

/** Live counts only — what a staff member changes (any member may update a dish row, see web 0059). */
export type DishCountPatch = Partial<Pick<KitchenDish, "hot_portions" | "fridge_portions" | "updated_by">>;

export async function updateKitchenDish(orgId: string, id: string, patch: DishCountPatch): Promise<void> {
  const full = { ...patch, updated_at: new Date().toISOString() };
  if (!isSupabaseConfigured) {
    const d = demo.kitchenDishes.find((x) => x.id === id);
    if (d) Object.assign(d, full);
    return;
  }
  const { error } = await getSupabase().from("kitchen_dishes").update(full).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Last 35 days of cooked / wasted / stock-out events. */
export async function listKitchenLog(orgId: string): Promise<KitchenLogEntry[]> {
  const since = new Date(Date.now() - 35 * 86400000).toISOString();
  if (!isSupabaseConfigured) return demo.kitchenLog.filter((l) => l.created_at >= since);
  const { data, error } = await getSupabase()
    .from("kitchen_log")
    .select("*")
    .eq("org_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as KitchenLogEntry[];
}

export async function logKitchen(
  orgId: string,
  entry: { dish: string; kind: KitchenLogKind; portions: number; by: string | null },
): Promise<void> {
  const row = {
    org_id: orgId,
    dish: entry.dish,
    kind: entry.kind,
    portions: entry.portions,
    value: 0,
    reason: null,
    created_by: entry.by,
  };
  if (!isSupabaseConfigured) {
    demo.kitchenLog.unshift({ id: uid(), created_at: new Date().toISOString(), ...row });
    return;
  }
  const { error } = await getSupabase().from("kitchen_log").insert(row);
  if (error) throw error;
}

/**
 * Ninety days of orders with only the columns the demand model reads — the same window the website uses, so the
 * forecast and "Today's prep" quantities match between the two.
 */
export async function listKitchenHistory(orgId: string): Promise<Order[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  if (!isSupabaseConfigured) return demo.orders.filter((o) => o.created_at >= since);
  const { data, error } = await getSupabase()
    .from("orders")
    .select(
      "id, org_id, order_number, order_type, guest_name, items, status, kitchen_status, kitchen_notes, source, created_at, kitchen_started_at, kitchen_ready_at, kitchen_served_at",
    )
    .eq("org_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as Order[];
}
