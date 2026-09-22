import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { KitchenDish, KitchenLogEntry, KitchenLogKind } from "@/lib/api/database.types";
import type { DishStandard } from "@/data/kitchen-standards";

const dDishes = demoTable<KitchenDish>("kitchen_dishes");
const dLog = demoTable<KitchenLogEntry>("kitchen_log");

export async function listKitchenDishes(orgId: string): Promise<KitchenDish[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dDishes.list({ org_id: orgId } as Partial<KitchenDish>).sort((a, b) => a.position - b.position);
  }
  const { data, error } = await getSupabase()
    .from("kitchen_dishes")
    .select("*")
    .eq("org_id", orgId)
    .order("position")
    .order("dish");
  if (error) throw error;
  return data ?? [];
}

export type DishPatch = Partial<Omit<KitchenDish, "id" | "org_id">>;

export async function updateKitchenDish(orgId: string, id: string, patch: DishPatch): Promise<void> {
  const full = { ...patch, updated_at: new Date().toISOString() };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDishes.update(id, full);
    return;
  }
  const { error } = await getSupabase().from("kitchen_dishes").update(full).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

export function newDishRow(orgId: string, s: Partial<DishStandard> & { dish: string }, position: number): Omit<KitchenDish, "id"> {
  return {
    org_id: orgId, recipe_id: null, dish: s.dish.trim(), terms: s.terms ?? s.dish.trim().toLowerCase(),
    method: s.method ?? "hot_hold", bain_marie: s.bain_marie ?? "no", open_pct: s.open_pct ?? 0.8,
    portion: s.portion ?? "1 serving", portion_g: s.portion_g ?? null, frozen: s.frozen ?? false, station: s.station ?? "curry",
    container: s.container ?? "", batch_portions: s.batch_portions ?? 3, min_portions: s.min_portions ?? 1,
    reorder_at: s.reorder_at ?? 2, prep_minutes: s.prep_minutes ?? 30, finish_minutes: s.finish_minutes ?? 2,
    target_wait_min: s.target_wait_min ?? 5, hold_temp_c: s.hold_temp_c ?? 65, max_hold_min: s.max_hold_min ?? 180,
    notes: s.notes ?? "", hot_portions: 0, fridge_portions: 0, position, is_active: true,
    updated_at: new Date().toISOString(), updated_by: null,
  };
}

export async function addKitchenDish(orgId: string, dish: string, position: number): Promise<void> {
  const row = newDishRow(orgId, { dish }, position);
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDishes.insert({ id: uid(), ...row });
    return;
  }
  const { error } = await getSupabase().from("kitchen_dishes").insert(row);
  if (error) throw error;
}

export async function removeKitchenDish(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDishes.remove(id);
    return;
  }
  const { error } = await getSupabase().from("kitchen_dishes").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Last 35 days of cooked / wasted / stock-out events — enough for the weekly review. */
export async function listKitchenLog(orgId: string): Promise<KitchenLogEntry[]> {
  const since = new Date(Date.now() - 35 * 86400000).toISOString();
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dLog.list({ org_id: orgId } as Partial<KitchenLogEntry>).filter((l) => l.created_at >= since);
  }
  const { data, error } = await getSupabase()
    .from("kitchen_log")
    .select("*")
    .eq("org_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function logKitchen(
  orgId: string,
  entry: { dish: string; kind: KitchenLogKind; portions: number; value?: number; reason?: string | null; by: string | null },
): Promise<void> {
  const row = {
    org_id: orgId, dish: entry.dish, kind: entry.kind, portions: entry.portions,
    value: entry.value ?? 0, reason: entry.reason ?? null, created_by: entry.by,
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dLog.insert({ id: uid(), created_at: new Date().toISOString(), ...row });
    return;
  }
  const { error } = await getSupabase().from("kitchen_log").insert(row);
  if (error) throw error;
}

export async function deleteKitchenLog(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dLog.remove(id);
    return;
  }
  const { error } = await getSupabase().from("kitchen_log").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
