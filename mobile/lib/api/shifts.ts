import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import { dayKey } from "@/lib/dates";
import type { Shift } from "@/lib/types";

/** My upcoming shifts, today onwards. Readable by every member; only managers assign them. */
export async function listMyShifts(orgId: string, employeeId: string): Promise<Shift[]> {
  const from = dayKey(new Date());
  if (!isSupabaseConfigured) {
    return demo.shifts
      .filter((s) => s.employee_id === employeeId && s.day >= from)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  const { data, error } = await getSupabase()
    .from("shifts")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("day", from)
    .order("day");
  if (error) throw error;
  return (data ?? []) as Shift[];
}
