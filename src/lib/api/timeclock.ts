import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { TimeEntry } from "@/lib/api/database.types";

const dEntries = demoTable<TimeEntry>("time_entries");

export async function listTimeEntries(orgId: string, daysBack = 14): Promise<TimeEntry[]> {
  const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dEntries
      .list({ org_id: orgId } as Partial<TimeEntry>)
      .filter((e) => e.clock_in >= cutoff)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in));
  }
  const { data, error } = await getSupabase()
    .from("time_entries")
    .select("*")
    .eq("org_id", orgId)
    .gte("clock_in", cutoff)
    .order("clock_in", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Only populated when the org has a geofence configured — see [[geo]]. */
export interface ClockInGeo {
  lat: number;
  lng: number;
  distanceM: number;
}

export async function clockIn(orgId: string, employeeId: string, geo?: ClockInGeo): Promise<void> {
  const geoCols = geo
    ? { clock_in_lat: geo.lat, clock_in_lng: geo.lng, clock_in_distance_m: geo.distanceM }
    : {};
  if (!isSupabaseConfigured) {
    await demoDelay();
    const open = dEntries
      .list({ org_id: orgId, employee_id: employeeId } as Partial<TimeEntry>)
      .find((e) => !e.clock_out);
    if (open) throw new Error("Already clocked in");
    dEntries.insert({
      id: uid(), org_id: orgId, employee_id: employeeId,
      clock_in: new Date().toISOString(), clock_out: null,
      break_seconds: 0, break_started_at: null, note: null,
      clock_in_lat: null, clock_in_lng: null, clock_in_distance_m: null,
      clock_out_lat: null, clock_out_lng: null, auto_clock_out: false,
      ...geoCols,
    });
    return;
  }
  const { error } = await getSupabase()
    .from("time_entries")
    .insert({ org_id: orgId, employee_id: employeeId, ...geoCols });
  if (error) {
    if (error.message.includes("one_open_entry")) throw new Error("Already clocked in");
    throw error;
  }
}

export interface ClockOutOpts {
  lat?: number;
  lng?: number;
  /** True when this clock-out wasn't the employee tapping the button — left the geofence, or the max-hours cron. */
  auto?: boolean;
}

export async function clockOut(orgId: string, entry: TimeEntry, opts?: ClockOutOpts): Promise<void> {
  // Close any running break first
  const extraBreak = entry.break_started_at
    ? Math.floor((Date.now() - new Date(entry.break_started_at).getTime()) / 1000)
    : 0;
  const patch = {
    clock_out: new Date().toISOString(),
    break_seconds: entry.break_seconds + extraBreak,
    break_started_at: null,
    ...(opts?.lat != null ? { clock_out_lat: opts.lat, clock_out_lng: opts.lng } : {}),
    ...(opts?.auto ? { auto_clock_out: true } : {}),
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEntries.update(entry.id, patch);
    return;
  }
  const { error } = await getSupabase()
    .from("time_entries")
    .update(patch)
    .eq("id", entry.id)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function toggleBreak(orgId: string, entry: TimeEntry): Promise<void> {
  const patch = entry.break_started_at
    ? {
        break_seconds:
          entry.break_seconds + Math.floor((Date.now() - new Date(entry.break_started_at).getTime()) / 1000),
        break_started_at: null,
      }
    : { break_started_at: new Date().toISOString() };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEntries.update(entry.id, patch);
    return;
  }
  const { error } = await getSupabase()
    .from("time_entries")
    .update(patch)
    .eq("id", entry.id)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Worked seconds for an entry (live for open entries, net of breaks). */
export function workedSeconds(entry: TimeEntry, now = Date.now()): number {
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : now;
  const runningBreak = entry.break_started_at
    ? Math.floor((now - new Date(entry.break_started_at).getTime()) / 1000)
    : 0;
  return Math.max(0, Math.floor((end - new Date(entry.clock_in).getTime()) / 1000) - entry.break_seconds - runningBreak);
}
