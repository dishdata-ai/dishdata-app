import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { Employee, Customer, Expense } from "@/lib/api/database.types";

const dEmployees = demoTable<Employee>("employees");
const dCustomers = demoTable<Customer>("customers");
const dExpenses = demoTable<Expense>("expenses");

export async function listEmployees(orgId: string): Promise<Employee[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dEmployees.list({ org_id: orgId } as Partial<Employee>);
  }
  const { data, error } = await getSupabase().from("employees").select("*").eq("org_id", orgId).order("name");
  if (error) throw error;
  return data ?? [];
}

/**
 * Link the signed-in user to their employee record (self-service "this is
 * me"). Guarded server-side, not just in the picker UI that calls this — the
 * claim only goes through if the target employee is still unlinked, so
 * calling this directly (or a race between two people clicking the same
 * unclaimed name) can never steal a profile someone else already claimed.
 */
export async function linkEmployeeToUser(orgId: string, employeeId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const target = dEmployees.list({ org_id: orgId } as Partial<Employee>).find((e) => e.id === employeeId);
    if (target?.user_id && target.user_id !== userId) {
      throw new Error("That profile is already linked to another account.");
    }
    // Unlink any previous claim by this user, then claim
    for (const e of dEmployees.list({ org_id: orgId } as Partial<Employee>)) {
      if (e.user_id === userId) dEmployees.update(e.id, { user_id: null });
    }
    dEmployees.update(employeeId, { user_id: userId });
    return;
  }
  // Goes through claim_employee (0047) rather than direct table updates —
  // plain members no longer have an update grant on employees at all, so
  // this is now the only way self-linking can work, and the unlink-then-
  // claim race guard lives server-side where it can't be bypassed.
  const { error } = await getSupabase().rpc("claim_employee", { _org: orgId, _employee: employeeId });
  if (error) throw error;
}

/**
 * Set or change your OWN pin (used for the discount-approval PIN and the
 * self-serve staff meal claim, 0048). Goes through set_my_pin (0049) rather
 * than updateEmployee — the update policy on employees is manager+ only
 * (0047), so this is the only column of your own row you can touch.
 */
export async function setMyPin(orgId: string, employeeId: string, pin: string): Promise<void> {
  const cleaned = pin.trim() || null;
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEmployees.update(employeeId, { pin: cleaned });
    return;
  }
  const { error } = await getSupabase().rpc("set_my_pin", { _org: orgId, _pin: cleaned });
  if (error) throw error;
}

export async function updateEmployee(orgId: string, id: string, patch: Partial<Employee>): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEmployees.update(id, patch);
    return;
  }
  const { error } = await getSupabase().from("employees").update(patch).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

export async function addEmployee(orgId: string, e: Omit<Employee, "id" | "org_id">): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEmployees.insert({ ...e, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("employees").insert({ ...e, org_id: orgId });
  if (error) throw error;
}

export async function listCustomers(orgId: string): Promise<Customer[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dCustomers
      .list({ org_id: orgId } as Partial<Customer>)
      .sort((a, b) => b.total_spend - a.total_spend);
  }
  const { data, error } = await getSupabase()
    .from("customers")
    .select("*")
    .eq("org_id", orgId)
    .order("total_spend", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addCustomer(orgId: string, c: Omit<Customer, "id" | "org_id">): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dCustomers.insert({ ...c, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("customers").insert({ ...c, org_id: orgId });
  if (error) throw error;
}

export async function listExpenses(orgId: string): Promise<Expense[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dExpenses
      .list({ org_id: orgId } as Partial<Expense>)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
  const { data, error } = await getSupabase()
    .from("expenses")
    .select("*")
    .eq("org_id", orgId)
    .order("date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addExpense(orgId: string, e: Omit<Expense, "id" | "org_id">): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dExpenses.insert({ ...e, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("expenses").insert({ ...e, org_id: orgId });
  if (error) throw error;
}

export async function deleteExpense(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dExpenses.remove(id);
    return;
  }
  const { error } = await getSupabase().from("expenses").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
