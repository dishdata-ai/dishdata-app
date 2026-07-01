import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";

export type DeliveryZone = {
  id: string;
  org_id: string;
  postcode: string;
  min_order: number;
  delivery_fee: number;
  is_active: boolean;
  created_at: string;
};

const dZones = demoTable<DeliveryZone>("delivery_zones");

function seedDemoZones(orgId: string) {
  if (dZones.list({ org_id: orgId } as Partial<DeliveryZone>).length > 0) return;
  const now = new Date().toISOString();
  const z = (postcode: string, min_order: number, delivery_fee: number) =>
    dZones.insert({ id: uid(), org_id: orgId, postcode, min_order, delivery_fee, is_active: true, created_at: now });
  z("10115", 20, 2.5);
  z("10117", 20, 2.5);
  z("10119", 25, 3.0);
  z("10243", 30, 3.5);
}

export async function listDeliveryZones(orgId: string): Promise<DeliveryZone[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    seedDemoZones(orgId);
    return dZones.list({ org_id: orgId } as Partial<DeliveryZone>).sort((a, b) => a.postcode.localeCompare(b.postcode));
  }
  const { data, error } = await getSupabase()
    .from("delivery_zones")
    .select("*")
    .eq("org_id", orgId)
    .order("postcode");
  if (error) throw error;
  return (data ?? []) as DeliveryZone[];
}

export async function upsertDeliveryZone(
  orgId: string,
  zone: Partial<DeliveryZone> & { id?: string },
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    if (zone.id) {
      dZones.update(zone.id, zone);
    } else {
      dZones.insert({
        id: uid(),
        org_id: orgId,
        postcode: "",
        min_order: 0,
        delivery_fee: 0,
        is_active: true,
        created_at: new Date().toISOString(),
        ...zone,
      });
    }
    return;
  }
  const sb = getSupabase();
  if (zone.id) {
    const { id, ...patch } = zone;
    const { error } = await sb.from("delivery_zones").update(patch).eq("id", id).eq("org_id", orgId);
    if (error) throw error;
  } else {
    const { error } = await sb.from("delivery_zones").insert({ org_id: orgId, ...zone });
    if (error) throw error;
  }
}

export async function deleteDeliveryZone(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dZones.remove(id);
    return;
  }
  const { error } = await getSupabase().from("delivery_zones").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
