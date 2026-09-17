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
  // Writes go through record_clock_in rather than a bare insert — see 0047:
  // any invariant an insert would need to respect (one open entry, no
  // fabricated timestamps) lives in that function, not in this client.
  const { error } = await getSupabase().rpc("record_clock_in", {
    _org: orgId,
    _employee: employeeId,
    _lat: geo?.lat ?? null,
    _lng: geo?.lng ?? null,
    _distance_m: geo?.distanceM ?? null,
  });
  if (error) throw error;
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
  const { error } = await getSupabase().rpc("record_clock_out", {
    _org: orgId,
    _entry: entry.id,
    _lat: opts?.lat ?? null,
    _lng: opts?.lng ?? null,
    _auto: opts?.auto ?? false,
  });
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
  const { error } = await getSupabase().rpc("record_toggle_break", { _org: orgId, _entry: entry.id });
  if (error) throw error;
}

export interface EditTimeEntryInput {
  clockIn: string; // ISO
  clockOut: string | null; // ISO, or null to leave the shift open
  breakSeconds: number;
  note?: string | null;
}

/**
 * Manager+ correction — fixing a stuck-open shift (clock_out stuck at null),
 * or an honest mistake in the times. Goes through edit_time_entry (0050),
 * the only write path into time_entries besides the three self-service RPCs
 * above; there's no plain update() left on this table (see 0047).
 */
export async function editTimeEntry(orgId: string, entryId: string, input: EditTimeEntryInput): Promise<void> {
  const patch = {
    clock_in: input.clockIn,
    clock_out: input.clockOut,
    break_seconds: Math.max(0, Math.round(input.breakSeconds)),
    break_started_at: null,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEntries.update(entryId, patch);
    return;
  }
  const { error } = await getSupabase().rpc("edit_time_entry", {
    _org: orgId,
    _entry: entryId,
    _clock_in: input.clockIn,
    _clock_out: input.clockOut,
    _break_seconds: Math.max(0, Math.round(input.breakSeconds)),
    _note: input.note ?? null,
  });
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
