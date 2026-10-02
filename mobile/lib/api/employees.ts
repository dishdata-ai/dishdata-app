import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Employee } from "@/lib/types";

/**
 * Staff records nobody has claimed yet — what the "Who are you?" step lists. The database only lets you see
 * your own record, and records with no login attached, so this can't show anyone's details.
 */
export async function listUnclaimedEmployees(orgId: string): Promise<Employee[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("employees")
    .select("*")
    .eq("org_id", orgId)
    .is("user_id", null)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Employee[];
}

/**
 * "This is me." Goes through claim_employee (migration 0047): plain members have no update access to the
 * employees table, and the database makes sure two people can't claim the same profile.
 */
export async function claimEmployee(orgId: string, employeeId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await getSupabase().rpc("claim_employee", { _org: orgId, _employee: employeeId });
  if (error) throw error;
}

/** Set or change your OWN PIN (migration 0049) — used for staff meals and discount approval at the till. */
export async function setMyPin(orgId: string, pin: string): Promise<void> {
  const cleaned = pin.trim() || null;
  if (!isSupabaseConfigured) {
    demo.me.pin = cleaned;
    return;
  }
  const { error } = await getSupabase().rpc("set_my_pin", { _org: orgId, _pin: cleaned });
  if (error) throw error;
}
