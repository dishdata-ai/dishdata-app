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

/** Link the signed-in user to their employee record (self-service "this is me"). */
export async function linkEmployeeToUser(orgId: string, employeeId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    // Unlink any previous claim by this user, then claim
    for (const e of dEmployees.list({ org_id: orgId } as Partial<Employee>)) {
      if (e.user_id === userId) dEmployees.update(e.id, { user_id: null });
    }
    dEmployees.update(employeeId, { user_id: userId });
    return;
  }
  const sb = getSupabase();
  await sb.from("employees").update({ user_id: null }).eq("org_id", orgId).eq("user_id", userId);
  const { error } = await sb.from("employees").update({ user_id: userId }).eq("id", employeeId).eq("org_id", orgId);
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
