import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import type { Shift } from "@/lib/api/database.types";

const dShifts = demoTable<Shift>("shifts");

/** Same lower bound as availability — past weeks aren't useful for planning. */
function fromDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function listShifts(orgId: string): Promise<Shift[]> {
  const from = fromDay();
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dShifts
      .list({ org_id: orgId } as Partial<Shift>)
      .filter((r) => r.day >= from)
      .sort((a, b) => a.day.localeCompare(b.day));
  }
  const { data, error } = await getSupabase()
    .from("shifts")
    .select("*")
    .eq("org_id", orgId)
    .gte("day", from)
    .order("day");
  if (error) throw error;
  return data ?? [];
}

export interface ShiftInput {
  start_time: string;
  end_time: string;
  role_title?: string | null;
  note?: string | null;
}

export async function setShift(orgId: string, employeeId: string, day: string, input: ShiftInput): Promise<void> {
  const row = {
    org_id: orgId,
    employee_id: employeeId,
    day,
    start_time: input.start_time,
    end_time: input.end_time,
    role_title: input.role_title?.trim() || null,
    note: input.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dShifts.list({ org_id: orgId, employee_id: employeeId, day } as Partial<Shift>)[0];
    if (existing) dShifts.update(existing.id, row);
    else dShifts.insert(row);
    return;
  }
  const { error } = await getSupabase().from("shifts").upsert(row, { onConflict: "employee_id,day" });
  if (error) throw error;
}

export async function removeShift(orgId: string, employeeId: string, day: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    for (const r of dShifts.list({ org_id: orgId, employee_id: employeeId, day } as Partial<Shift>)) {
      dShifts.remove(r.id);
    }
    return;
  }
  const { error } = await getSupabase()
    .from("shifts")
    .delete()
    .eq("org_id", orgId)
    .eq("employee_id", employeeId)
    .eq("day", day);
  if (error) throw error;
}
