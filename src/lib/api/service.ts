// Tables, reservations and deliveries.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  RestaurantTable,
  TableStatus,
  Reservation,
  ReservationStatus,
  Delivery,
  DeliveryStatus,
} from "@/lib/api/database.types";

const dTables = demoTable<RestaurantTable>("restaurant_tables");
const dReservations = demoTable<Reservation>("reservations");
const dDeliveries = demoTable<Delivery>("deliveries");

// ---- Tables ----

export async function listTables(orgId: string): Promise<RestaurantTable[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTables
      .list({ org_id: orgId } as Partial<RestaurantTable>)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  const { data, error } = await getSupabase()
    .from("restaurant_tables")
    .select("*")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function setTableStatus(orgId: string, tableId: string, status: TableStatus): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTables.update(tableId, { status });
    return;
  }
  const { error } = await getSupabase()
    .from("restaurant_tables")
    .update({ status })
    .eq("id", tableId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function addTable(orgId: string, name: string, seats: number, zone: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTables.insert({ id: uid(), org_id: orgId, name, seats, zone, status: "open" });
    return;
  }
  const { error } = await getSupabase()
    .from("restaurant_tables")
    .insert({ org_id: orgId, name, seats, zone });
  if (error) throw error;
}

// ---- Reservations ----

export async function listReservations(orgId: string): Promise<Reservation[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dReservations
      .list({ org_id: orgId } as Partial<Reservation>)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  const { data, error } = await getSupabase()
    .from("reservations")
    .select("*")
    .eq("org_id", orgId)
    .gte("starts_at", new Date(Date.now() - 86400000).toISOString())
    .order("starts_at");
  if (error) throw error;
  return data ?? [];
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
    await demoDelay();
    dReservations.insert({
      id: uid(), org_id: orgId, customer_id: null, duration_min: 90,
      status: "booked", source: "staff", ...r,
    });
    if (r.table_id) dTables.update(r.table_id, { status: "reserved" });
    return;
  }
  const sb = getSupabase();
  const { error } = await sb.from("reservations").insert({ org_id: orgId, ...r });
  if (error) throw error;
  if (r.table_id) {
    await sb.from("restaurant_tables").update({ status: "reserved" }).eq("id", r.table_id);
  }
}

export async function setReservationStatus(
  orgId: string,
  reservation: Reservation,
  status: ReservationStatus,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dReservations.update(reservation.id, { status });
    if (reservation.table_id) {
      dTables.update(reservation.table_id, {
        status: status === "seated" ? "seated" : status === "completed" ? "cleaning" : "open",
      });
    }
    return;
  }
  const sb = getSupabase();
  const { error } = await sb
    .from("reservations")
    .update({ status })
    .eq("id", reservation.id)
    .eq("org_id", orgId);
  if (error) throw error;
  if (reservation.table_id) {
    await sb
      .from("restaurant_tables")
      .update({ status: status === "seated" ? "seated" : status === "completed" ? "cleaning" : "open" })
      .eq("id", reservation.table_id);
  }
}

// ---- Deliveries ----

export async function listDeliveries(orgId: string): Promise<Delivery[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dDeliveries
      .list({ org_id: orgId } as Partial<Delivery>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("deliveries")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function updateDelivery(
  orgId: string,
  deliveryId: string,
  patch: Partial<Pick<Delivery, "status" | "courier_employee_id" | "address" | "eta" | "notes">>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDeliveries.update(deliveryId, patch);
    return;
  }
  const { error } = await getSupabase()
    .from("deliveries")
    .update(patch)
    .eq("id", deliveryId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export const DELIVERY_FLOW: DeliveryStatus[] = ["pending", "assigned", "picked_up", "delivered"];
