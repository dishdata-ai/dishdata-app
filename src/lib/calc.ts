// Pure computation helpers over live data — costing, popularity, time series.

import type { Order, Recipe, RecipeIngredient } from "@/lib/api/database.types";

export interface RecipeWithIngredients extends Recipe {
  ingredients: RecipeIngredient[];
}

export const recipeCost = (r: { ingredients: { cost: number }[] }) =>
  r.ingredients.reduce((s, i) => s + i.cost, 0);

export const marginPct = (r: RecipeWithIngredients) =>
  r.price > 0 ? ((r.price - recipeCost(r)) / r.price) * 100 : 0;

export const foodCostPct = (r: RecipeWithIngredients) =>
  r.price > 0 ? (recipeCost(r) / r.price) * 100 : 0;

/** Sentinel for "sold out indefinitely" — far enough out it never lapses on its own. */
export const SOLD_OUT_INDEFINITELY = "9999-12-31T00:00:00.000Z";

/** ISO timestamp for the end of today (local time) — used for "sold out today" toggles. */
export function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export const isSoldOut = (r: Pick<Recipe, "sold_out_until">) =>
  !!r.sold_out_until && new Date(r.sold_out_until) > new Date();

export const isSoldOutIndefinitely = (r: Pick<Recipe, "sold_out_until">) =>
  !!r.sold_out_until && new Date(r.sold_out_until).getUTCFullYear() >= 9999;

/** Units sold per recipe id across orders. */
export function unitsSold(orders: Order[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "void" || o.status === "refunded") continue;
    for (const line of o.items) {
      map.set(line.recipe_id, (map.get(line.recipe_id) ?? 0) + line.qty);
    }
  }
  return map;
}

/** Popularity 0-100: recipe's share of units relative to the best seller. */
export function popularityScores(recipes: Recipe[], orders: Order[]): Map<string, number> {
  const sold = unitsSold(orders);
  const max = Math.max(1, ...sold.values());
  const map = new Map<string, number>();
  for (const r of recipes) {
    map.set(r.id, Math.round(((sold.get(r.id) ?? 0) / max) * 100));
  }
  return map;
}

const dayKey = (iso: string) => iso.slice(0, 10);

export interface SeriesPoint {
  label: string;
  revenue: number;
  orders: number;
}

/** Revenue/order-count series for the last N days (inclusive of today). */
export function revenueByDay(orders: Order[], days: number): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>();
  const out: SeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const point = { label: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }), revenue: 0, orders: 0 };
    buckets.set(key, point);
    out.push(point);
  }
  for (const o of orders) {
    if (o.status === "void" || o.status === "refunded") continue;
    const b = buckets.get(dayKey(o.created_at));
    if (b) {
      b.revenue += o.total;
      b.orders += 1;
    }
  }
  for (const p of out) p.revenue = Math.round(p.revenue);
  return out;
}

/** Revenue by hour for a given day (default today). */
export function revenueByHour(orders: Order[], dayOffset = 0): SeriesPoint[] {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  const key = d.toISOString().slice(0, 10);
  const hours = Array.from({ length: 13 }, (_, i) => i + 10); // 10:00 → 22:00
  const points = hours.map((h) => ({ label: `${h}:00`, revenue: 0, orders: 0 }));
  for (const o of orders) {
    if (dayKey(o.created_at) !== key) continue;
    if (o.status === "void" || o.status === "refunded") continue;
    const h = new Date(o.created_at).getHours();
    const idx = hours.indexOf(h);
    if (idx >= 0) {
      points[idx].revenue += o.total;
      points[idx].orders += 1;
    }
  }
  for (const p of points) p.revenue = Math.round(p.revenue);
  return points;
}

export function ordersInRange(orders: Order[], daysBack: number, daysBackEnd = 0): Order[] {
  const start = new Date();
  start.setDate(start.getDate() - daysBack);
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setDate(end.getDate() - daysBackEnd);
  end.setHours(23, 59, 59, 999);
  return orders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= start.getTime() && t <= end.getTime();
  });
}

export const sumRevenue = (orders: Order[]) =>
  orders.filter((o) => o.status !== "void" && o.status !== "refunded").reduce((s, o) => s + o.total, 0);

/** % change between two values (0 when previous is 0). */
export const pctChange = (current: number, previous: number) =>
  previous === 0 ? 0 : +(((current - previous) / previous) * 100).toFixed(1);

/** Naive forecast: average revenue by weekday over history, projected forward. */
export function forecastSeries(orders: Order[], historyDays = 14, forecastDays = 5) {
  const history = revenueByDay(orders, historyDays);
  const byWeekday = new Map<number, number[]>();
  for (let i = 0; i < historyDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (historyDays - 1 - i));
    const wd = d.getDay();
    if (!byWeekday.has(wd)) byWeekday.set(wd, []);
    byWeekday.get(wd)!.push(history[i].revenue);
  }
  const avgFor = (wd: number) => {
    const arr = byWeekday.get(wd) ?? [];
    return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
  };
  const out: { day: string; actual: number | null; forecast: number }[] = history.map((p, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (historyDays - 1 - i));
    return { day: p.label, actual: p.revenue, forecast: avgFor(d.getDay()) };
  });
  for (let i = 1; i <= forecastDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    out.push({
      day: d.toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
      actual: null,
      forecast: avgFor(d.getDay()),
    });
  }
  return out;
}

/** Currency formatter honoring org currency. */
export function currencyFormatter(currency: string) {
  return (n: number, digits = 0) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(n);
}
