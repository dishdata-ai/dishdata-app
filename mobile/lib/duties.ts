import type { DutyAssignment, Employee, StaffRole } from "@/lib/types";

/** The duties that can be handed to a person, in the order the checklists are shown. */
export const DUTY_ORDER: (StaffRole | null)[] = [
  "frontend",
  "frontend_helper",
  "kitchen_lead",
  "commi_kitchen",
  "kitchen_helper",
  "manager",
  "admin",
  "owner",
  null,
];

export const DUTY_LABELS: Record<StaffRole, string> = {
  frontend: "Frontend",
  frontend_helper: "Frontend Helper",
  kitchen_lead: "Head Chef / Kitchen Lead",
  commi_kitchen: "Commi",
  kitchen_helper: "Kitchen Helper",
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
};

/** Duties the signed-in person holds — as a staff record or as a login. */
export function myDuties(duties: DutyAssignment[], me: Pick<Employee, "id"> | null, userId: string | undefined): Set<StaffRole> {
  return new Set(
    duties
      .filter((d) => (me && d.employee_id === me.id) || (userId && d.user_id === userId))
      .map((d) => d.duty),
  );
}
