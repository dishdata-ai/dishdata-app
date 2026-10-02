import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { PartnerMealUsage, StaffMealUsage } from "@/lib/types";

/**
 * Today's staff-meal allowance for one employee (the staff_meal_usage RPC, migration 0070). Throws if the
 * database doesn't have it yet — callers treat that as "no card" rather than showing a wrong number.
 */
export async function getStaffMealUsage(orgId: string, employeeId: string): Promise<StaffMealUsage | null> {
  if (!isSupabaseConfigured) {
    // Demo has no orders to spend against, so it's always a fresh day; clocked in if the demo shift is open.
    const org = demo.org;
    const limit = org.staff_meal_daily_limit ?? null;
    const working = org.staff_meal_pct_off == null ? true : Boolean(demo.timeEntry);
    return {
      used: 0,
      orders: 0,
      limit,
      remaining: working && limit ? limit : 0,
      working_today: working,
      pct: (working ? org.staff_meal_pct_working : org.staff_meal_pct_off) ?? 0,
      drinks_remaining: org.staff_meal_free_drinks ?? null,
    };
  }
  const { data, error } = await getSupabase().rpc("staff_meal_usage", { _org: orgId, _employee: employeeId });
  if (error) throw error;
  return data as StaffMealUsage;
}

/** This calendar month's free partner meals for the signed-in partner (partner_meal_usage RPC, migration 0070). */
export async function getPartnerMealUsage(orgId: string): Promise<PartnerMealUsage | null> {
  if (!isSupabaseConfigured) {
    const count = demo.org.partner_meal_monthly_count ?? null;
    return { eligible: true, count, max_value: demo.org.partner_meal_max_value ?? null, used: 0, remaining: count ?? 0 };
  }
  const { data, error } = await getSupabase().rpc("partner_meal_usage", { _org: orgId });
  if (error) throw error;
  return data as PartnerMealUsage;
}
