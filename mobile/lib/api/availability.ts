import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import { dayKey, weekDays } from "@/lib/dates";
import type { AvailabilityStatus, StaffAvailability } from "@/lib/types";

/** My own availability from the start of this week on — past weeks are no use for planning. */
export async function listMyAvailability(orgId: string, employeeId: string): Promise<StaffAvailability[]> {
  const from = dayKey(weekDays(0)[0]);
  if (!isSupabaseConfigured) {
    return demo.availability.filter((r) => r.employee_id === employeeId && r.day >= from);
  }
  const { data, error } = await getSupabase()
    .from("staff_availability")
    .select("*")
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .gte("day", from)
    .order("day");
  if (error) throw error;
  return (data ?? []) as StaffAvailability[];
}

export interface AvailabilityInput {
  status: AvailabilityStatus;
  from_time?: string | null;
  to_time?: string | null;
  note?: string | null;
}

export async function setAvailability(
  orgId: string,
  employeeId: string,
  day: string,
  input: AvailabilityInput,
): Promise<void> {
  const row = {
    org_id: orgId,
    employee_id: employeeId,
    day,
    status: input.status,
    // A window only means something for "some hours"; drop it otherwise so a stale 16:00–23:00 doesn't linger.
    from_time: input.status === "partial" ? input.from_time ?? null : null,
    to_time: input.status === "partial" ? input.to_time ?? null : null,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (!isSupabaseConfigured) {
    const existing = demo.availability.find((r) => r.employee_id === employeeId && r.day === day);
    if (existing) Object.assign(existing, row);
    else demo.availability.push({ id: uid(), ...row });
    return;
  }
  const { error } = await getSupabase().from("staff_availability").upsert(row, { onConflict: "employee_id,day" });
  if (error) throw error;
}

/** Back to "hasn't said". */
export async function clearAvailability(orgId: string, employeeId: string, day: string): Promise<void> {
  if (!isSupabaseConfigured) {
    demo.availability = demo.availability.filter((r) => !(r.employee_id === employeeId && r.day === day));
    return;
  }
  const { error } = await getSupabase()
    .from("staff_availability")
    .delete()
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("day", day);
  if (error) throw error;
}
