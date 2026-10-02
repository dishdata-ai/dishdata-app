import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { TimeEntry } from "@/lib/types";

/** The currently-open (not clocked-out) shift for an employee, if any. */
export async function getOpenShift(
  orgId: string,
  employeeId: string,
): Promise<TimeEntry | null> {
  if (!isSupabaseConfigured) {
    return demo.timeEntry && !demo.timeEntry.clock_out ? demo.timeEntry : null;
  }
  const { data, error } = await getSupabase()
    .from("time_entries")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .is("clock_out", null)
    .order("clock_in", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TimeEntry) ?? null;
}

/** Only filled in when the restaurant has a geofence set up. */
export interface ClockInGeo {
  lat: number;
  lng: number;
  distanceM: number;
}

// Writes to time_entries go through record_clock_in / record_clock_out / record_toggle_break (migration 0047), the
// same as the web app. The table has no insert or update policy at all — a plain insert/update is refused — so
// the old direct writes here only ever worked in demo mode.
export async function clockIn(orgId: string, employeeId: string, geo?: ClockInGeo): Promise<void> {
  if (!isSupabaseConfigured) {
    if (demo.timeEntry && !demo.timeEntry.clock_out) throw new Error("Already clocked in");
    demo.timeEntry = {
      id: uid(),
      org_id: orgId,
      employee_id: employeeId,
      clock_in: new Date().toISOString(),
      clock_out: null,
      break_seconds: 0,
      break_started_at: null,
      note: null,
    };
    return;
  }
  const { error } = await getSupabase().rpc("record_clock_in", {
    _org: orgId,
    _employee: employeeId,
    _lat: geo?.lat ?? null,
    _lng: geo?.lng ?? null,
    _distance_m: geo?.distanceM ?? null,
  });
  if (error) throw error;
}

export async function clockOut(orgId: string, entry: TimeEntry): Promise<void> {
  if (!isSupabaseConfigured) {
    if (demo.timeEntry?.id === entry.id) {
      // Close a running break first, like the server does.
      if (demo.timeEntry.break_started_at) {
        demo.timeEntry.break_seconds += Math.max(
          0,
          Math.round((Date.now() - new Date(demo.timeEntry.break_started_at).getTime()) / 1000),
        );
        demo.timeEntry.break_started_at = null;
      }
      demo.timeEntry.clock_out = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase().rpc("record_clock_out", {
    _org: orgId,
    _entry: entry.id,
    _lat: null,
    _lng: null,
    _auto: false,
  });
  if (error) throw error;
}

export async function toggleBreak(orgId: string, entry: TimeEntry): Promise<void> {
  if (!isSupabaseConfigured) {
    if (!demo.timeEntry) return;
    if (entry.break_started_at) {
      const elapsed = Math.round((Date.now() - new Date(entry.break_started_at).getTime()) / 1000);
      demo.timeEntry.break_seconds += elapsed;
      demo.timeEntry.break_started_at = null;
    } else {
      demo.timeEntry.break_started_at = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase().rpc("record_toggle_break", { _org: orgId, _entry: entry.id });
  if (error) throw error;
}

/** My own finished and open shifts for the last few weeks — what the My hours screen lists. */
export async function listMyTimeEntries(orgId: string, employeeId: string, daysBack = 28): Promise<TimeEntry[]> {
  const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString();
  if (!isSupabaseConfigured) {
    return [...(demo.timeEntry ? [demo.timeEntry] : []), ...demo.timeHistory]
      .filter((e) => e.employee_id === employeeId && e.clock_in >= cutoff)
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in));
  }
  const { data, error } = await getSupabase()
    .from("time_entries")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("clock_in", cutoff)
    .order("clock_in", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeEntry[];
}
