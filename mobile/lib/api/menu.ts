import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Recipe } from "@/lib/types";

export async function listMenu(orgId: string): Promise<Recipe[]> {
  if (!isSupabaseConfigured) {
    return demo.recipes.filter((r) => r.is_active);
  }
  const { data, error } = await getSupabase()
    .from("recipes")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("category");
  if (error) throw error;
  return data ?? [];
}
