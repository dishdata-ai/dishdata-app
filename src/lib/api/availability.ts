import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import type { StaffAvailability, AvailabilityStatus } from "@/lib/api/database.types";

const dAvailability = demoTable<StaffAvailability>("staff_availability");

/** Local-calendar YYYY-MM-DD. toISOString() would shift the day for anyone east/west of UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday→Sunday of the week `offset` weeks from the current one (0 = this week). */
export function weekDays(offset: number): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** "15–21 Sep" style label for a week. */
export function weekLabel(days: Date[]): string {
  const a = days[0];
  const b = days[6];
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

/** "16:00:00" (Postgres time) → "16:00". */
export const shortTime = (t: string | null) => (t ? t.slice(0, 5) : "");

/** Everything from the start of the current week on — past weeks are no use for planning. */
export async function listAvailability(orgId: string): Promise<StaffAvailability[]> {
  const from = dayKey(weekDays(0)[0]);
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dAvailability
      .list({ org_id: orgId } as Partial<StaffAvailability>)
      .filter((r) => r.day >= from)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  const { data, error } = await getSupabase()
    .from("staff_availability")
    .select("*")
    .eq("org_id", orgId)
    .gte("day", from)
    .order("day");
  if (error) throw error;
  return data ?? [];
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
    // A window only means something for "some hours"; drop it otherwise so a
    // stale 16:00–23:00 doesn't linger on a day now marked fully available.
    from_time: input.status === "partial" ? input.from_time ?? null : null,
    to_time: input.status === "partial" ? input.to_time ?? null : null,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dAvailability
      .list({ org_id: orgId, employee_id: employeeId, day } as Partial<StaffAvailability>)[0];
    if (existing) dAvailability.update(existing.id, row);
    else dAvailability.insert(row);
    return;
  }
  const { error } = await getSupabase()
    .from("staff_availability")
    .upsert(row, { onConflict: "employee_id,day" });
  if (error) throw error;
}

/** Back to "hasn't said". */
export async function clearAvailability(orgId: string, employeeId: string, day: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    for (const r of dAvailability.list({ org_id: orgId, employee_id: employeeId, day } as Partial<StaffAvailability>)) {
      dAvailability.remove(r.id);
    }
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
