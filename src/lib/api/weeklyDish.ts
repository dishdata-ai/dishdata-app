import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { WeeklyDish } from "@/lib/api/database.types";

const dDishes = demoTable<WeeklyDish>("weekly_dish");

export type WeeklyDishInput = Pick<WeeklyDish, "starts_on" | "recipe_id" | "headline" | "region" | "story">;

export async function listWeeklyDishes(orgId: string): Promise<WeeklyDish[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dDishes.list({ org_id: orgId } as Partial<WeeklyDish>);
  }
  const { data, error } = await getSupabase()
    .from("weekly_dish")
    .select("*")
    .eq("org_id", orgId)
    .order("starts_on", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveWeeklyDish(orgId: string, input: WeeklyDishInput, existing?: WeeklyDish): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    if (existing) dDishes.update(existing.id, { ...input, updated_at: now });
    else dDishes.insert({ id: uid(), org_id: orgId, created_at: now, updated_at: now, ...input });
    return;
  }
  const sb = getSupabase();
  const { error } = existing
    ? await sb.from("weekly_dish").update(input).eq("id", existing.id).eq("org_id", orgId)
    : await sb.from("weekly_dish").insert({ org_id: orgId, ...input });
  if (error) {
    if (error.code === "23505") throw new Error("A dish of the week is already planned for that start date.");
    throw error;
  }
}

export async function deleteWeeklyDish(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDishes.remove(id);
    return;
  }
  const { error } = await getSupabase().from("weekly_dish").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
