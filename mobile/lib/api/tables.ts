import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { RestaurantTable } from "@/lib/types";

export async function listTables(orgId: string): Promise<RestaurantTable[]> {
  if (!isSupabaseConfigured) {
    return [...demo.tables].sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await getSupabase()
    .from("restaurant_tables")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
