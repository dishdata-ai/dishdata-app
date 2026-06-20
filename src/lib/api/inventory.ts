import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoAudit, pushDemoNotification } from "@/lib/api/notifications";
import type { InventoryItem, InventoryTransaction, InvReason, WasteReason } from "@/lib/api/database.types";

const dItems = demoTable<InventoryItem>("inventory_items");
const dTx = demoTable<InventoryTransaction>("inventory_transactions");

export async function listInventory(orgId: string): Promise<InventoryItem[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dItems.list({ org_id: orgId } as Partial<InventoryItem>);
  }
  const { data, error } = await getSupabase()
    .from("inventory_items")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function addInventoryItem(
  orgId: string,
  item: Omit<InventoryItem, "id" | "org_id">,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dItems.insert({ ...item, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("inventory_items").insert({ ...item, org_id: orgId });
  if (error) throw error;
}

export async function updateInventoryItem(
  _orgId: string,
  id: string,
  patch: Partial<Omit<InventoryItem, "id" | "org_id">>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dItems.update(id, patch);
    return;
  }
  const { error } = await getSupabase().from("inventory_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function adjustStock(
  orgId: string,
  item: InventoryItem,
  delta: number,
  reason: InvReason,
  wasteReason?: WasteReason,
  note?: string,
): Promise<void> {
  const newStock = Math.max(0, +(item.stock + delta).toFixed(2));
  if (!isSupabaseConfigured) {
    await demoDelay();
    dItems.update(item.id, { stock: newStock });
    dTx.insert({
      id: uid(), org_id: orgId, item_id: item.id, item_name: item.name, delta,
      reason, waste_reason: wasteReason ?? null, ref_order_id: null, note: note ?? null,
      created_at: new Date().toISOString(),
    });
    pushDemoAudit(orgId, "inventory_items", "UPDATE", item.id, { name: `${item.name} ${delta > 0 ? "+" : ""}${delta} (${reason})` });
    if (newStock < item.par_level * 0.5 && item.stock >= item.par_level * 0.5) {
      pushDemoNotification(
        orgId, "low_stock", `Low stock: ${item.name}`,
        `Only ${newStock} ${item.unit} left (par ${item.par_level})`, "inventory",
      );
    }
    return;
  }
  const sb = getSupabase();
  const { error } = await sb.from("inventory_items").update({ stock: newStock }).eq("id", item.id);
  if (error) throw error;
  const { error: txError } = await sb.from("inventory_transactions").insert({
    org_id: orgId, item_id: item.id, item_name: item.name, delta, reason,
    waste_reason: wasteReason ?? null, note: note ?? null,
  });
  if (txError) throw txError;
}

export async function listTransactions(orgId: string, limit = 200): Promise<InventoryTransaction[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTx
      .list({ org_id: orgId } as Partial<InventoryTransaction>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("inventory_transactions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
