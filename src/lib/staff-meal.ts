// Staff meal pricing, in one place so the till preview, the demo-mode checkout and the
// "what do I have left" cards all quote the same number the database will charge.
//
// The rules (mirrored by staff_meal_split() / checkout_order() in migration 0070):
//  * On a day the employee clocked in: a free credit (org.staff_meal_daily_limit) comes off first,
//    covering food and at most `free drinks` drinks per day; whatever is left is charged at the
//    working-day staff rate.
//  * On a day they did not clock in (only when the org has set an off-day rate): no free credit,
//    the whole order is just the off-day rate.

/** Same word list as is_drink_category() in 0070 — keep the two in step. */
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
