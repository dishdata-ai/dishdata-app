import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { InventoryItem } from "@/lib/types";

export async function listInventory(orgId: string): Promise<InventoryItem[]> {
  if (!isSupabaseConfigured) {
    return [...demo.inventory].sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await getSupabase()
    .from("inventory_items")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** Adjust stock by a delta and record the reason (waste, count, adjustment). */
export async function adjustStock(
  orgId: string,
  itemId: string,
  delta: number,
  reason: "waste" | "count" | "adjustment",
): Promise<void> {
  if (!isSupabaseConfigured) {
    const it = demo.inventory.find((x) => x.id === itemId);
    if (it) it.stock = Math.max(0, +(it.stock + delta).toFixed(2));
    return;
  }
  const sb = getSupabase();
  const { data: item } = await sb
    .from("inventory_items")
    .select("stock")
    .eq("id", itemId)
    .single();
  const next = Math.max(0, (item?.stock ?? 0) + delta);
  const { error } = await sb
    .from("inventory_items")
    .update({ stock: next })
    .eq("id", itemId)
    .eq("org_id", orgId);
  if (error) throw error;
  await sb.from("inventory_transactions").insert({
    org_id: orgId,
    item_id: itemId,
    delta,
    reason,
  });
}
