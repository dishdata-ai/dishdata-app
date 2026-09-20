import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { DutyAssignment, Employee, StaffRole, Task } from "@/lib/api/database.types";

const dDuties = demoTable<DutyAssignment>("duty_assignments");

/** The duties that can be handed to a person (the other StaffRole values are access levels). */
export const DUTY_ROLES = ["frontend", "kitchen_lead", "commi_kitchen"] as const satisfies readonly StaffRole[];

export const DUTY_LABELS: Record<StaffRole, string> = {
  frontend: "Frontend",
  kitchen_lead: "Head Chef / Kitchen Lead",
  commi_kitchen: "Commi / Kitchen Helper",
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
};

export type DutyPerson = { employee_id: string } | { user_id: string };

export async function listDuties(orgId: string): Promise<DutyAssignment[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dDuties.list({ org_id: orgId } as Partial<DutyAssignment>);
  }
  const { data, error } = await getSupabase().from("duty_assignments").select("*").eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}

export async function addDuty(orgId: string, duty: StaffRole, person: DutyPerson): Promise<void> {
  const row = {
    org_id: orgId,
    duty,
    employee_id: "employee_id" in person ? person.employee_id : null,
    user_id: "user_id" in person ? person.user_id : null,
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDuties.insert({ id: uid(), created_at: new Date().toISOString(), ...row });
    return;
  }
  const { error } = await getSupabase().from("duty_assignments").insert(row);
  if (error) throw error;
}

export async function removeDuty(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dDuties.remove(id);
    return;
  }
  const { error } = await getSupabase().from("duty_assignments").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Duties the signed-in person holds — as a staff record or as a login (partner/manager). */
export function myDuties(
  duties: DutyAssignment[],
  me: Pick<Employee, "id"> | null,
  userId: string | undefined,
): Set<StaffRole> {
  return new Set(
    duties
      .filter((d) => (me && d.employee_id === me.id) || (userId && d.user_id === userId))
      .map((d) => d.duty),
  );
}

/** Open a task for someone if it belongs to one of their duties. */
export const isMyDutyTask = (t: Task, mine: Set<StaffRole>) => !!t.assigned_role && mine.has(t.assigned_role);
