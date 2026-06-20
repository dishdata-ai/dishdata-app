import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { AssetMaintenance } from "@/lib/api/database.types";

const dMaint = demoTable<AssetMaintenance>("asset_maintenance");

export async function listMaintenance(orgId: string): Promise<AssetMaintenance[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dMaint
      .list({ org_id: orgId } as Partial<AssetMaintenance>)
      .sort((a, b) => b.performed_at.localeCompare(a.performed_at));
  }
  const { data, error } = await getSupabase()
    .from("asset_maintenance")
    .select("*")
    .eq("org_id", orgId)
    .order("performed_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addMaintenanceLog(
  orgId: string,
  log: Omit<AssetMaintenance, "id" | "org_id" | "created_at">,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dMaint.insert({ ...log, id: uid(), org_id: orgId, created_at: new Date().toISOString() });
    return;
  }
  const { error } = await getSupabase().from("asset_maintenance").insert({ ...log, org_id: orgId });
  if (error) throw error;
}
