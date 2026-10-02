import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import { minutesToTime } from "@/lib/preorders";
import type { PreorderEvent, PreorderOrder } from "@/lib/types";

export async function listPreorderEvents(orgId: string): Promise<PreorderEvent[]> {
  if (!isSupabaseConfigured) return demo.preorderEvents;
  const { data, error } = await getSupabase()
    .from("preorder_events")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PreorderEvent[];
}

export async function listPreorderOrders(orgId: string, eventId: string): Promise<PreorderOrder[]> {
  if (!isSupabaseConfigured) return demo.preorderOrders.filter((o) => o.event_id === eventId);
  const { data, error } = await getSupabase()
    .from("preorder_orders")
    .select("*")
    .eq("org_id", orgId)
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as PreorderOrder[];
}

async function updatePreorderOrder(orgId: string, id: string, patch: Partial<PreorderOrder>): Promise<void> {
  if (!isSupabaseConfigured) {
    const o = demo.preorderOrders.find((x) => x.id === id);
    if (o) Object.assign(o, patch, { updated_at: new Date().toISOString() });
    return;
  }
  const { error } = await getSupabase().from("preorder_orders").update(patch).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Seat a party at a time. Passing null clears the seating and sends it back to the queue. */
export async function assignTimeslot(
  orgId: string,
  id: string,
  startMin: number | null,
  slotMinutes = 60,
): Promise<void> {
  await updatePreorderOrder(
    orgId,
    id,
    startMin === null
      ? { timeslot_start: null, timeslot_end: null }
      : { timeslot_start: minutesToTime(startMin), timeslot_end: minutesToTime(startMin + slotMinutes) },
  );
}

export const cancelPreorderOrder = (orgId: string, id: string) => updatePreorderOrder(orgId, id, { status: "cancelled" });
export const restorePreorderOrder = (orgId: string, id: string) => updatePreorderOrder(orgId, id, { status: "confirmed" });
