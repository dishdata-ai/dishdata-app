// Staff meal and partner meal pricing, in one place so the till preview and the demo-mode checkout quote the
// same number the database charges. The first half is a straight port of the web app's src/lib/staff-meal.ts
// (tested against the real checkout_order function, migration 0070) — keep the two in step.
//
// The rules:
//  * On a day the employee clocked in: a free credit comes off first, covering food and at most `free drinks`
//    drinks per day; whatever is left is charged at the working-day staff rate.
//  * On a day they did not clock in (only when the org set an off-day rate): no credit, the whole order is just
//    the off-day rate.
//  * A partner meal is one of the partner's free meals this month: free up to an optional ceiling.

import type { PartnerMealUsage, StaffMealUsage } from "@/lib/types";

/** Same word list as is_drink_category() in migration 0070. */
const DRINK_CATEGORIES = new Set(["beverages", "beverage", "drinks", "drink", "getränke"]);

export const isDrinkCategory = (category: string | null | undefined): boolean =>
  DRINK_CATEGORIES.has((category ?? "").trim().toLowerCase());

export interface MealLine {
  price: number;
  qty: number;
  category: string | null | undefined;
}

export interface MealState {
  /** Clocked in today (always true for orgs that haven't set an off-day rate). */
  working: boolean;
  /** Free € still available today. */
  credit: number;
  /** Drinks the free credit may still cover today; null = no cap. */
  drinksLeft: number | null;
  /** % off whatever the free credit doesn't cover. */
  pct: number;
}

export interface MealQuote {
  /** € covered by the free credit. */
  free: number;
  /** Drinks that used a free-drink slot. */
  freeDrinks: number;
  /** € left over after the free credit, charged at `pct` off. */
  residual: number;
  pct: number;
  /** Total € off the order (free credit + the discount on the residual). */
  discount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function quoteStaffMeal(lines: MealLine[], state: MealState): MealQuote {
  const gross = lines.reduce((t, l) => t + l.price * l.qty, 0);
  let free = 0;
  let freeDrinks = 0;
  if (state.working) {
    let left = Math.max(state.credit, 0);
    const food = lines.filter((l) => !isDrinkCategory(l.category)).reduce((t, l) => t + l.price * l.qty, 0);
    free = Math.min(food, left);
    left -= free;
    let slots = state.drinksLeft ?? Infinity;
    for (const l of lines) {
      if (!isDrinkCategory(l.category)) continue;
      for (let i = 0; i < Math.floor(l.qty) && left > 0 && slots > 0; i++) {
        const take = Math.min(l.price, left);
        free += take;
        left -= take;
        slots -= 1;
        freeDrinks += 1;
      }
    }
  }
  free = round2(free);
  const residual = round2(gross - free);
  const pct = Math.max(state.pct, 0);
  return { free, freeDrinks, residual, pct, discount: round2(free + (residual * pct) / 100) };
}

// ---------------------------------------------------------------------------
// What the till does with it
// ---------------------------------------------------------------------------

/** Who counts as a partner: the same people the web app lets into the Partner Hub (owner, admin, partner). */
export const PARTNER_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "partner"]);

export type MealClaim = "none" | "meal" | "partner";

export interface ClaimPrice {
  /** Total € off the order. */
  discount: number;
  /** € of that which is the free credit / free meal (the rest is the staff rate). */
  free: number;
  freeDrinks: number;
  /** % off the part the credit doesn't cover (staff meal only). */
  pct: number;
  /** Why this claim can't go ahead right now, or null when it can. */
  blocked: string | null;
}

const NONE: ClaimPrice = { discount: 0, free: 0, freeDrinks: 0, pct: 0, blocked: null };

/**
 * Price an order for a claim. `staff` / `partner` are the server's usage figures; null means they haven't loaded
 * (or the database can't answer), and then the claim is blocked rather than guessed.
 */
export function priceClaim(
  claim: MealClaim,
  lines: MealLine[],
  staff: StaffMealUsage | null | undefined,
  partner: PartnerMealUsage | null | undefined,
): ClaimPrice {
  if (claim === "meal") {
    if (!staff) return { ...NONE, blocked: "Checking your allowance…" };
    const q = quoteStaffMeal(lines, {
      working: staff.working_today ?? true,
      credit: staff.remaining,
      drinksLeft: staff.drinks_remaining ?? null,
      pct: staff.pct ?? 0,
    });
    return { discount: q.discount, free: q.free, freeDrinks: q.freeDrinks, pct: q.pct, blocked: null };
  }
  if (claim === "partner") {
    if (!partner) return { ...NONE, blocked: "Checking your partner meals…" };
    if (!partner.eligible) return { ...NONE, blocked: "Partner meals are for partners only." };
    if ((partner.count ?? 0) <= 0) return { ...NONE, blocked: "Partner meals are switched off." };
    if (partner.remaining <= 0) {
      return { ...NONE, blocked: "No free partner meals left this month — ring this one up normally instead." };
    }
    const gross = lines.reduce((t, l) => t + l.price * l.qty, 0);
    const free = round2(Math.min(gross, partner.max_value ?? gross));
    return { discount: free, free, freeDrinks: 0, pct: 0, blocked: null };
  }
  return NONE;
}
