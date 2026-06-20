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

export async function clockIn(orgId: string, employeeId: string): Promise<void> {
  if (!isSupabaseConfigured) {
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
  const { error } = await getSupabase()
    .from("time_entries")
    .insert({ org_id: orgId, employee_id: employeeId, clock_in: new Date().toISOString() });
  if (error) throw error;
}

export async function clockOut(orgId: string, entryId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    if (demo.timeEntry?.id === entryId) demo.timeEntry.clock_out = new Date().toISOString();
    return;
  }
  const { error } = await getSupabase()
    .from("time_entries")
    .update({ clock_out: new Date().toISOString() })
    .eq("id", entryId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function toggleBreak(orgId: string, entry: TimeEntry): Promise<void> {
  const onBreak = Boolean(entry.break_started_at);
  if (!isSupabaseConfigured) {
    if (!demo.timeEntry) return;
    if (onBreak) {
      const elapsed = Math.round((Date.now() - new Date(entry.break_started_at!).getTime()) / 1000);
      demo.timeEntry.break_seconds += elapsed;
      demo.timeEntry.break_started_at = null;
    } else {
      demo.timeEntry.break_started_at = new Date().toISOString();
    }
    return;
  }
  const patch = onBreak
    ? {
        break_started_at: null,
        break_seconds:
          entry.break_seconds +
          Math.round((Date.now() - new Date(entry.break_started_at!).getTime()) / 1000),
      }
    : { break_started_at: new Date().toISOString() };
  const { error } = await getSupabase()
    .from("time_entries")
    .update(patch)
    .eq("id", entry.id)
    .eq("org_id", orgId);
  if (error) throw error;
}
