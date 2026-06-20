import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { StorageLocation } from "@/lib/api/database.types";

const dLoc = demoTable<StorageLocation>("storage_locations");

export async function listLocations(orgId: string): Promise<StorageLocation[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dLoc
      .list({ org_id: orgId } as Partial<StorageLocation>)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const { data, error } = await getSupabase()
    .from("storage_locations")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function addLocation(
  orgId: string,
  loc: Omit<StorageLocation, "id" | "org_id">,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dLoc.insert({ ...loc, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("storage_locations").insert({ ...loc, org_id: orgId });
  if (error) throw error;
}

export async function updateLocation(
  _orgId: string,
  id: string,
  patch: Partial<Omit<StorageLocation, "id" | "org_id">>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dLoc.update(id, patch);
    return;
  }
  const { error } = await getSupabase().from("storage_locations").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteLocation(_orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dLoc.remove(id);
    return;
  }
  const { error } = await getSupabase().from("storage_locations").delete().eq("id", id);
  if (error) throw error;
}
