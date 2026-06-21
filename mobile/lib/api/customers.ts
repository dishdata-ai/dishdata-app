import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Customer } from "@/lib/types";

export async function listCustomers(orgId: string): Promise<Customer[]> {
  if (!isSupabaseConfigured) {
    return [...demo.customers].sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await getSupabase()
    .from("customers")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
