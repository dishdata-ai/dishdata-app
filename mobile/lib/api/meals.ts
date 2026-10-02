import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Order, PartnerMealUsage, StaffMealUsage } from "@/lib/types";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const counts = (o: Order) => o.status !== "void" && o.status !== "refunded";

/** Demo-mode stand-in for the staff_meal_usage RPC: counts today's meal claims made in the demo till. */
export function demoStaffMealUsage(employeeId: string): StaffMealUsage {
  const org = demo.org;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const mine = demo.orders.filter(
    (o) =>
      o.staff_discount_employee_id === employeeId &&
      (o.staff_meal_amount ?? 0) > 0 &&
      counts(o) &&
      new Date(o.created_at) >= dayStart,
  );
  const used = round2(mine.reduce((s, o) => s + (o.staff_meal_amount ?? 0), 0));
  const drinksUsed = mine.reduce((s, o) => s + (o.staff_meal_drinks ?? 0), 0);
  const limit = org.staff_meal_daily_limit ?? null;
  const offPct = org.staff_meal_pct_off ?? null;
  // An off-day rate is what switches the working-day rule on; the demo is "clocked in" while its shift is open.
  const working = offPct == null ? true : Boolean(demo.timeEntry);
  const freeDrinks = org.staff_meal_free_drinks ?? null;
  return {
    used,
    orders: mine.length,
    limit,
    remaining: !working || !limit ? 0 : Math.max(limit - used, 0),
    working_today: working,
    pct: (working ? org.staff_meal_pct_working : offPct) ?? 0,
    drinks_remaining: freeDrinks == null ? null : Math.max(freeDrinks - drinksUsed, 0),
  };
}

/** Demo-mode stand-in for the partner_meal_usage RPC: this month's partner meals taken in the demo till. */
export function demoPartnerMealUsage(): PartnerMealUsage {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const used = demo.orders.filter(
    (o) => o.partner_meal_user_id === demo.me.user_id && counts(o) && new Date(o.created_at) >= monthStart,
  ).length;
  const count = demo.org.partner_meal_monthly_count ?? null;
  return {
    eligible: true,
    count,
    max_value: demo.org.partner_meal_max_value ?? null,
    used,
    remaining: !count ? 0 : Math.max(count - used, 0),
  };
}

/**
 * Today's staff-meal allowance for one employee (the staff_meal_usage RPC, migration 0070). Throws if the
 * database doesn't have it yet — callers treat that as "no card" rather than showing a wrong number.
 */
export async function getStaffMealUsage(orgId: string, employeeId: string): Promise<StaffMealUsage | null> {
  if (!isSupabaseConfigured) return demoStaffMealUsage(employeeId);
  const { data, error } = await getSupabase().rpc("staff_meal_usage", { _org: orgId, _employee: employeeId });
  if (error) throw error;
  return data as StaffMealUsage;
}

/** This calendar month's free partner meals for the signed-in partner (partner_meal_usage RPC, migration 0070). */
export async function getPartnerMealUsage(orgId: string): Promise<PartnerMealUsage | null> {
  if (!isSupabaseConfigured) return demoPartnerMealUsage();
  const { data, error } = await getSupabase().rpc("partner_meal_usage", { _org: orgId });
  if (error) throw error;
  return data as PartnerMealUsage;
}
