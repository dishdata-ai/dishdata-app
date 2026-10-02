import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { Reservation, ReservationStatus, TableStatus } from "@/lib/types";

export async function setTableStatus(orgId: string, tableId: string, status: TableStatus): Promise<void> {
  if (!isSupabaseConfigured) {
    const t = demo.tables.find((x) => x.id === tableId);
    if (t) t.status = status;
    return;
  }
  const { error } = await getSupabase()
    .from("restaurant_tables")
    .update({ status })
    .eq("id", tableId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** From yesterday on — the same window the website lists, so a late-running booking is still there. */
export async function listReservations(orgId: string): Promise<Reservation[]> {
  const since = new Date(Date.now() - 86400000).toISOString();
  if (!isSupabaseConfigured) {
    return demo.reservations.filter((r) => r.starts_at >= since).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("*")
    .eq("org_id", orgId)
    .gte("starts_at", since)
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as Reservation[];
}

export interface NewReservation {
  guest_name: string;
  phone: string | null;
  party_size: number;
  starts_at: string;
  table_id: string | null;
  note: string | null;
}

export async function createReservation(orgId: string, r: NewReservation): Promise<void> {
  if (!isSupabaseConfigured) {
    demo.reservations.push({
      id: uid(), org_id: orgId, customer_id: null, duration_min: 90, status: "booked", source: "staff", ...r,
    });
    if (r.table_id) {
      const t = demo.tables.find((x) => x.id === r.table_id);
      if (t) t.status = "reserved";
    }
    return;
  }
  const sb = getSupabase();
  const { error } = await sb.from("reservations").insert({ org_id: orgId, ...r });
  if (error) throw error;
  if (r.table_id) {
    const { error: tErr } = await sb.from("restaurant_tables").update({ status: "reserved" }).eq("id", r.table_id);
    if (tErr) throw tErr;
  }
}

/** Seating a booking seats its table; completing it sends the table to cleaning; anything else frees it. */
export async function setReservationStatus(
  orgId: string,
  reservation: Reservation,
  status: ReservationStatus,
): Promise<void> {
  const tableStatus: TableStatus = status === "seated" ? "seated" : status === "completed" ? "cleaning" : "open";
  if (!isSupabaseConfigured) {
    const r = demo.reservations.find((x) => x.id === reservation.id);
    if (r) r.status = status;
    const t = reservation.table_id ? demo.tables.find((x) => x.id === reservation.table_id) : null;
    if (t) t.status = tableStatus;
    return;
  }
  const sb = getSupabase();
  const { error } = await sb.from("reservations").update({ status }).eq("id", reservation.id).eq("org_id", orgId);
  if (error) throw error;
  if (reservation.table_id) {
    const { error: tErr } = await sb.from("restaurant_tables").update({ status: tableStatus }).eq("id", reservation.table_id);
    if (tErr) throw tErr;
  }
}
