// Kitchen Ops calculations. Pure functions over orders, kitchen dishes and the kitchen log —
// no React, no fetching — so the maths is in one place and easy to check.
//
// Model (mirrors the Kokoland Kitchen Efficiency workbook):
//  * Every order line is converted into production components. A combo counts toward each
//    component it contains ("Porotta with Beef Curry" = 1 Porotta + 1 Beef Curry).
//  * Demand per weekday/hour is a weighted average over the days the kitchen actually
//    served: the most recent 14 days count double so it reacts to current demand.
//  * Recommended prep = expected demand x (1 + safety) - usable stock.

import type { KitchenDish, KitchenLogEntry, Order } from "@/lib/types";
import { STOVE_STATIONS, CHEF_STATIONS, type Station } from "@/lib/kitchen-standards";

export const OPEN_HOUR = 11;
export const LAST_HOUR = 22; // hours 11..22 (22:00–22:59 is the last service hour)
export const HOURS = Array.from({ length: LAST_HOUR - OPEN_HOUR + 1 }, (_, i) => OPEN_HOUR + i);
export const SAFETY = 0.15;
const RECENT_DAYS = 14;
const HISTORY_DAYS = 90;

export const DAYPARTS: { id: string; label: string; from: number; to: number }[] = [
  { id: "lunch", label: "Lunch", from: 11, to: 14 },
  { id: "afternoon", label: "Afternoon", from: 15, to: 17 },
  { id: "dinner", label: "Dinner", from: 18, to: 20 },
  { id: "late", label: "Late", from: 21, to: 22 },
];

/** "Before lunch" covers 11:00–16:59, "before dinner" 17:00 to close. */
export const SERVICE_BLOCKS = {
  lunch: { label: "Before Lunch", from: 11, to: 16 },
  dinner: { label: "Before Dinner", from: 17, to: 22 },
} as const;
export type ServiceBlock = keyof typeof SERVICE_BLOCKS;

/** Kitchen weekdays, Monday closed. Values are JS getDay() numbers. */
export const WEEKDAYS: { day: number; label: string; short: string }[] = [
  { day: 2, label: "Tuesday", short: "Tue" },
  { day: 3, label: "Wednesday", short: "Wed" },
  { day: 4, label: "Thursday", short: "Thu" },
  { day: 5, label: "Friday", short: "Fri" },
  { day: 6, label: "Saturday", short: "Sat" },
  { day: 0, label: "Sunday", short: "Sun" },
];

/** Next open kitchen day after `from` (Monday is normally closed). */
export function nextServiceDay(from: Date = new Date()): number {
  let d = (from.getDay() + 1) % 7;
  if (d === 1) d = 2;
  return d;
}

// ---------------------------------------------------------------- matching

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

interface CompiledDish {
  dish: KitchenDish;
  terms: string[];
  res: RegExp[];
}

const compileCache = new WeakMap<KitchenDish[], CompiledDish[]>();

function compile(dishes: KitchenDish[]): CompiledDish[] {
  let c = compileCache.get(dishes);
  if (!c) {
    c = dishes.map((dish) => {
      const terms = (dish.terms || dish.dish).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      return { dish, terms, res: terms.map((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}([^a-z0-9]|$)`)) };
    });
    compileCache.set(dishes, c);
  }
  return c;
}

/**
 * Which components does an order line use? A term must match as whole words. When a more specific
 * component also matches ("Chicken 65 Biriyani" contains "chicken 65"), the shorter one is dropped.
 */
export function matchDishes(lineName: string, dishes: KitchenDish[]): KitchenDish[] {
  const n = lineName.toLowerCase();
  const hits = compile(dishes)
    .map((c) => ({ c, hit: c.terms.filter((_, i) => c.res[i].test(n)) }))
    .filter((x) => x.hit.length > 0);
  return hits
    .filter((a) => !hits.some((b) => b !== a && b.hit.some((bt) => a.hit.every((at) => bt !== at && bt.includes(at)))))
    .map((x) => x.c.dish);
}

// ---------------------------------------------------------------- demand model

const dateKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const countable = (o: Order) => o.status !== "void" && o.status !== "refunded";

export interface DishDemand {
  /** Weighted average portions per service day, by JS weekday (0=Sun..6=Sat). Null when that weekday was never observed. */
  perWeekday: (number | null)[];
  /** [weekday][hour] weighted average portions in that hour. */
  perWeekdayHour: number[][];
  overall: number;
  /** Change in daily average: last 6 service days vs the 6 before (fraction), null if not enough days. */
  trend: number | null;
  total: number;
}

export interface DemandModel {
  serviceDays: number;
  firstDate: Date | null;
  lastDate: Date | null;
  /** How many service days were observed per JS weekday. */
  samples: number[];
  byDish: Map<string, DishDemand>;
  /** All-component average portions per hour on a typical service day, by weekday. */
  totalPerWeekdayHour: number[][];
}

const zero2d = () => Array.from({ length: 7 }, () => Array<number>(24).fill(0));

export function buildDemand(orders: Order[], dishes: KitchenDish[], now: Date = new Date()): DemandModel {
  const since = now.getTime() - HISTORY_DAYS * 86400000;
  // dateKey -> { date, dish -> hour[24] }
  const days = new Map<string, { date: Date; per: Map<string, number[]> }>();
  for (const o of orders) {
    if (!countable(o)) continue;
    const t = new Date(o.created_at);
    if (t.getTime() < since || t.getTime() > now.getTime() + 86400000) continue;
    const key = dateKey(t);
    let day = days.get(key);
    if (!day) days.set(key, (day = { date: new Date(t.getFullYear(), t.getMonth(), t.getDate()), per: new Map() }));
    const hour = t.getHours();
    for (const line of o.items) {
      for (const dish of matchDishes(line.name, dishes)) {
        let arr = day.per.get(dish.id);
        if (!arr) day.per.set(dish.id, (arr = Array(24).fill(0)));
        arr[hour] += line.qty;
      }
    }
  }

  const list = [...days.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cutoff = now.getTime() - RECENT_DAYS * 86400000;
  const weight = (d: Date) => (d.getTime() >= cutoff ? 2 : 1);

  const samples = Array<number>(7).fill(0);
  const weightSum = Array<number>(7).fill(0);
  for (const d of list) {
    samples[d.date.getDay()] += 1;
    weightSum[d.date.getDay()] += weight(d.date);
  }
  const totalWeight = list.reduce((s, d) => s + weight(d.date), 0);

  const byDish = new Map<string, DishDemand>();
  const totalPerWeekdayHour = zero2d();
  for (const dish of dishes) {
    const perWeekdayHour = zero2d();
    const perWeekdaySum = Array<number>(7).fill(0);
    let overallSum = 0;
    let total = 0;
    const dailyTotals: number[] = [];
    for (const d of list) {
      const arr = d.per.get(dish.id);
      const w = weight(d.date);
      const wd = d.date.getDay();
      let dayTotal = 0;
      if (arr) {
        for (let h = 0; h < 24; h++) {
          perWeekdayHour[wd][h] += arr[h] * w;
          dayTotal += arr[h];
        }
      }
      perWeekdaySum[wd] += dayTotal * w;
      overallSum += dayTotal * w;
      total += dayTotal;
      dailyTotals.push(dayTotal);
    }
    for (let wd = 0; wd < 7; wd++) {
      if (weightSum[wd] > 0) for (let h = 0; h < 24; h++) perWeekdayHour[wd][h] /= weightSum[wd];
      for (let h = 0; h < 24; h++) totalPerWeekdayHour[wd][h] += perWeekdayHour[wd][h];
    }
    const perWeekday = perWeekdaySum.map((s, wd) => (weightSum[wd] > 0 ? s / weightSum[wd] : null));
    let trend: number | null = null;
    if (dailyTotals.length >= 12) {
      const recent = dailyTotals.slice(-6).reduce((a, b) => a + b, 0) / 6;
      const prior = dailyTotals.slice(-12, -6).reduce((a, b) => a + b, 0) / 6;
      trend = prior > 0 ? recent / prior - 1 : null;
    }
    byDish.set(dish.id, { perWeekday, perWeekdayHour, overall: totalWeight > 0 ? overallSum / totalWeight : 0, trend, total });
  }

  return {
    serviceDays: list.length,
    firstDate: list[0]?.date ?? null,
    lastDate: list[list.length - 1]?.date ?? null,
    samples,
    byDish,
    totalPerWeekdayHour,
  };
}

/** Expected portions of a dish for a weekday hour bucket; falls back to the overall daily average spread by hour share when a weekday was never seen. */
export function expectedHour(model: DemandModel, dishId: string, weekday: number, hour: number, multiplier = 1): number {
  const dd = model.byDish.get(dishId);
  if (!dd) return 0;
  if (model.samples[weekday] > 0) return dd.perWeekdayHour[weekday][hour] * multiplier;
  // never observed on this weekday: use the average of all observed weekdays
  let sum = 0;
  let n = 0;
  for (let wd = 0; wd < 7; wd++) if (model.samples[wd] > 0) (sum += dd.perWeekdayHour[wd][hour]), n++;
  return n ? (sum / n) * multiplier : 0;
}

/** Expected portions between two fractional hours (e.g. 13.5 to 15.5) — partial hours count proportionally. */
export function expectedBetween(model: DemandModel, dishId: string, weekday: number, fromH: number, toH: number, multiplier = 1): number {
  let total = 0;
  for (let h = Math.floor(fromH); h < Math.ceil(toH); h++) {
    if (h < OPEN_HOUR || h > LAST_HOUR) continue;
    const overlap = Math.min(toH, h + 1) - Math.max(fromH, h);
    if (overlap > 0) total += expectedHour(model, dishId, weekday, h, multiplier) * overlap;
  }
  return total;
}

export const expectedDay = (model: DemandModel, dishId: string, weekday: number, multiplier = 1) =>
  expectedBetween(model, dishId, weekday, OPEN_HOUR, LAST_HOUR + 1, multiplier);

export const expectedBlock = (model: DemandModel, dishId: string, weekday: number, block: ServiceBlock, multiplier = 1) =>
  expectedBetween(model, dishId, weekday, SERVICE_BLOCKS[block].from, SERVICE_BLOCKS[block].to + 1, multiplier);

/** Average and peak portions per hour on a weekday (over the hours the dish actually sells). */
export function ordersPerHour(model: DemandModel, dishId: string, weekday: number) {
  const vals = HOURS.map((h) => expectedHour(model, dishId, weekday, h));
  const day = vals.reduce((a, b) => a + b, 0);
  return { avg: day / HOURS.length, peak: Math.max(0, ...vals), day };
}

// ---------------------------------------------------------------- live status

export type LiveStatus = "enough" | "soon" | "urgent" | "not_needed";

export const STATUS_META: Record<LiveStatus, { label: string; tone: "green" | "amber" | "rose" | "neutral" }> = {
  enough: { label: "Enough stock", tone: "green" },
  soon: { label: "Prepare / reheat soon", tone: "amber" },
  urgent: { label: "Urgent — prepare now", tone: "rose" },
  not_needed: { label: "Not currently needed", tone: "neutral" },
};

const VERB: Record<KitchenDish["method"], string> = {
  hot_hold: "Cook", fridge_reheat: "Reheat", pan_finish: "Pre-cook & portion", fresh: "Prep / marinate", batch_portion: "Prepare", assembly: "Set up",
};

/** "1 batch = 4 portions (need 2)" — kitchens cook in batches, so say it that way. */
function batchText(need: number, batch: number): string {
  if (batch <= 1) return `${need} more`;
  const batches = Math.ceil(need / batch);
  const portions = batches * batch;
  return `${batches} batch${batches > 1 ? "es" : ""} = ${portions} portions${portions !== need ? ` (need ${need})` : ""}`;
}

export interface LiveRow {
  dish: KitchenDish;
  hot: number;
  fridge: number;
  usable: number;
  nextHour: number;
  next2h: number;
  restOfDay: number;
  waiting: number;
  status: LiveStatus;
  recommend: number;
  action: string;
  /** Extra warning, e.g. the freezer stock won't last the day. */
  note: string | null;
}

/** Portions currently wanted by tickets that are still open (not ready). */
export function waitingByDish(orders: Order[], dishes: KitchenDish[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "void" || o.kitchen_status === "ready" || o.kitchen_status === "served") continue;
    if (now - new Date(o.created_at).getTime() > 12 * 3600000) continue;
    for (const l of o.items) {
      if (l.ready) continue;
      for (const d of matchDishes(l.name, dishes)) out.set(d.id, (out.get(d.id) ?? 0) + l.qty);
    }
  }
  return out;
}

export function liveRows(
  model: DemandModel,
  dishes: KitchenDish[],
  waiting: Map<string, number>,
  now: Date = new Date(),
  multiplier = 1,
): LiveRow[] {
  const wd = now.getDay();
  const h = now.getHours() + now.getMinutes() / 60;
  return dishes
    .filter((d) => d.is_active)
    .map((dish) => {
      const hot = dish.hot_portions;
      const fridge = dish.fridge_portions;
      const usable = hot + fridge;
      const nextHour = expectedBetween(model, dish.id, wd, h, h + 1, multiplier);
      const next2h = expectedBetween(model, dish.id, wd, h, h + 2, multiplier);
      const restOfDay = expectedBetween(model, dish.id, wd, Math.max(h, OPEN_HOUR), LAST_HOUR + 1, multiplier);
      const wait = waiting.get(dish.id) ?? 0;
      const need = Math.ceil(next2h * (1 + SAFETY));
      const recommend = Math.max(0, need - usable, wait - usable);

      let status: LiveStatus;
      if (restOfDay < 0.75 && wait === 0) status = "not_needed";
      else if (recommend === 0) status = "enough";
      else if (usable <= dish.reorder_at || wait > usable) status = "urgent";
      else status = "soon";

      let action = "";
      if (status === "not_needed") action = "Nothing needed right now";
      else if (status === "enough") action = "Enough for the next 2 hours";
      else if (dish.frozen) {
        action = `Cook ${batchText(recommend, dish.batch_portions)} from frozen`;
      } else {
        const fromFridge = dish.method === "hot_hold" || dish.method === "fridge_reheat" ? Math.min(fridge, recommend) : 0;
        const cook = recommend - fromFridge;
        const parts: string[] = [];
        if (fromFridge > 0) parts.push(`Reheat ${fromFridge} from the fridge`);
        if (cook > 0) parts.push(`${VERB[dish.method]} ${batchText(cook, dish.batch_portions)}`);
        action = parts.join(" + ");
      }
      const note = dish.frozen && restOfDay >= 0.75 && fridge < Math.ceil(restOfDay) ? `Freezer stock (${fridge}) won't cover today's ~${Math.ceil(restOfDay)} — order more` : null;
      return { dish, hot, fridge, usable, nextHour, next2h, restOfDay, waiting: wait, status, recommend, action, note };
    });
}

const STATUS_RANK: Record<LiveStatus, number> = { urgent: 0, soon: 1, enough: 2, not_needed: 3 };
export const sortByUrgency = (rows: LiveRow[]) =>
  [...rows].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.nextHour - a.nextHour);

// ---------------------------------------------------------------- prep board

export interface PrepLine {
  dish: KitchenDish;
  expected: number;
  /** Portions to have ready at opening (coverage % of the block's need). */
  opening: number;
  /** Portions to make during service. */
  during: number;
  usable: number;
  /** What still has to be made before the block starts. */
  toPrep: number;
  text: string;
}

const phrase = (d: KitchenDish, n: number, during: number): string => {
  const more = during > 0 ? ` (+${during} during service)` : "";
  if (d.frozen) return `${n} portions out of the freezer, cook from frozen${more}`;
  switch (d.method) {
    case "hot_hold": return d.bain_marie === "yes" ? `${n} portions hot in the bain-marie${more}` : `${n} portions ready & hot${more}`;
    case "fridge_reheat": return `${n} portions cooked & chilled — reheat to order${more}`;
    case "pan_finish": return `${n} pre-portioned, chilled — finish in the pan${more}`;
    case "fresh": return `${n} portions prepped & portioned — cook fresh to order${more}`;
    case "batch_portion": return `${n} portions prepared — finish to order${more}`;
    case "assembly": return `${n} portions of components ready — assemble${more}`;
  }
};

export function prepBoard(model: DemandModel, dishes: KitchenDish[], weekday: number, block: ServiceBlock, multiplier = 1): PrepLine[] {
  return dishes
    .filter((d) => d.is_active)
    .map((dish) => {
      const expected = expectedBlock(model, dish.id, weekday, block, multiplier);
      const need = Math.ceil(expected * (1 + SAFETY));
      const opening = expected < 0.3 ? 0 : Math.min(need, Math.max(dish.min_portions, Math.ceil(need * dish.open_pct)));
      const during = Math.max(0, need - opening);
      const usable = dish.hot_portions + dish.fridge_portions;
      const toPrep = Math.max(0, opening - usable);
      return { dish, expected, opening, during, usable, toPrep, text: opening > 0 ? phrase(dish, opening, during) : "Not needed unless ordered" };
    })
    .sort((a, b) => b.expected - a.expected);
}

// ---------------------------------------------------------------- service speed

const ageMin = (iso: string, now: number) => Math.max(0, (now - new Date(iso).getTime()) / 60000);

export interface SpeedStats {
  waiting: number;
  over10: number;
  over15: number;
  oldest: number;
  mostDelayed: { dish: string; minutes: number } | null;
  stationLoad: Record<string, number>;
  busiestStation: { station: string; qty: number } | null;
  pansNow: number;
  fryerLoad: number;
  stoveLoad: number;
  chefMinutes: number;
  helperMinutes: number;
  /** Today's finished tickets (those with timestamps). */
  measured: number;
  avgWait: number | null;
  maxWait: number | null;
  avgStartLag: number | null;
}

export function speedStats(orders: Order[], dishes: KitchenDish[], now: number = Date.now()): SpeedStats {
  const today = new Date(now).toDateString();
  const open = orders.filter(
    (o) => o.status !== "void" && (o.kitchen_status === "new" || o.kitchen_status === "preparing") && now - new Date(o.created_at).getTime() < 12 * 3600000,
  );
  const stationLoad: Record<string, number> = {};
  const delayed = new Map<string, number>();
  const pans = new Map<string, number>();
  let fryerLoad = 0, stoveLoad = 0, chefMinutes = 0, helperMinutes = 0;
  for (const o of open) {
    const age = ageMin(o.created_at, now);
    for (const l of o.items) {
      if (l.ready) continue;
      for (const d of matchDishes(l.name, dishes)) {
        stationLoad[d.station] = (stationLoad[d.station] ?? 0) + l.qty;
        delayed.set(d.dish, Math.max(delayed.get(d.dish) ?? 0, age));
        if (d.station === "pan") pans.set(d.id, (pans.get(d.id) ?? 0) + l.qty);
        if (d.station === "fryer") fryerLoad += l.qty;
        if (STOVE_STATIONS.includes(d.station as Station)) stoveLoad += l.qty;
        if (CHEF_STATIONS.includes(d.station as Station)) chefMinutes += l.qty * d.finish_minutes;
        else helperMinutes += l.qty * Math.max(1, d.finish_minutes);
        helperMinutes += 0.5 * l.qty; // plating / hand-over
      }
    }
  }
  const worst = [...delayed.entries()].sort((a, b) => b[1] - a[1])[0];
  const busiest = Object.entries(stationLoad).sort((a, b) => b[1] - a[1])[0];

  const done = orders.filter((o) => o.kitchen_ready_at && new Date(o.created_at).toDateString() === today);
  const waits = done.map((o) => (new Date(o.kitchen_ready_at!).getTime() - new Date(o.created_at).getTime()) / 60000);
  const lags = done.filter((o) => o.kitchen_started_at).map((o) => (new Date(o.kitchen_started_at!).getTime() - new Date(o.created_at).getTime()) / 60000);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  return {
    waiting: open.length,
    over10: open.filter((o) => ageMin(o.created_at, now) >= 10).length,
    over15: open.filter((o) => ageMin(o.created_at, now) >= 15).length,
    oldest: open.length ? Math.max(...open.map((o) => ageMin(o.created_at, now))) : 0,
    mostDelayed: worst ? { dish: worst[0], minutes: worst[1] } : null,
    stationLoad,
    busiestStation: busiest ? { station: busiest[0], qty: busiest[1] } : null,
    pansNow: [...pans.values()].reduce((s, q) => s + Math.ceil(q / 2), 0),
    fryerLoad,
    stoveLoad,
    chefMinutes,
    helperMinutes,
    measured: waits.length,
    avgWait: avg(waits),
    maxWait: waits.length ? Math.max(...waits) : null,
    avgStartLag: avg(lags),
  };
}

export interface DaySpeed {
  date: Date;
  tickets: number;
  avg: number;
  max: number;
  over10: number;
  over15: number;
}

/** Order-to-ready time per day for the last `days` days (only tickets that have kitchen timestamps). */
export function speedHistory(orders: Order[], days = 7, now: number = Date.now()): DaySpeed[] {
  const map = new Map<string, number[]>();
  for (const o of orders) {
    if (!o.kitchen_ready_at || now - new Date(o.created_at).getTime() > days * 86400000) continue;
    const key = new Date(o.created_at).toDateString();
    const w = (new Date(o.kitchen_ready_at).getTime() - new Date(o.created_at).getTime()) / 60000;
    (map.get(key) ?? map.set(key, []).get(key)!).push(w);
  }
  return [...map.entries()]
    .map(([k, w]) => ({
      date: new Date(k), tickets: w.length, avg: w.reduce((a, b) => a + b, 0) / w.length,
      max: Math.max(...w), over10: w.filter((x) => x >= 10).length, over15: w.filter((x) => x >= 15).length,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

// ---------------------------------------------------------------- sales & waste

/** Portions sold per dish on the given calendar day. */
export function soldOnDay(orders: Order[], dishes: KitchenDish[], day: Date): Map<string, number> {
  const key = day.toDateString();
  const out = new Map<string, number>();
  for (const o of orders) {
    if (!countable(o) || new Date(o.created_at).toDateString() !== key) continue;
    for (const l of o.items) for (const d of matchDishes(l.name, dishes)) out.set(d.id, (out.get(d.id) ?? 0) + l.qty);
  }
  return out;
}

export interface WasteRow {
  dish: string;
  cooked: number;
  wasted: number;
  value: number;
  pct: number | null;
  stockouts: number;
}

export function wasteStats(log: KitchenLogEntry[], days: number, now: number = Date.now()): WasteRow[] {
  const map = new Map<string, WasteRow>();
  for (const e of log) {
    if (now - new Date(e.created_at).getTime() > days * 86400000) continue;
    const r = map.get(e.dish) ?? { dish: e.dish, cooked: 0, wasted: 0, value: 0, pct: null, stockouts: 0 };
    if (e.kind === "cooked") r.cooked += Number(e.portions);
    else if (e.kind === "wasted") (r.wasted += Number(e.portions)), (r.value += Number(e.value));
    else r.stockouts += 1;
    map.set(e.dish, r);
  }
  return [...map.values()]
    .map((r) => ({ ...r, pct: r.cooked > 0 ? (r.wasted / r.cooked) * 100 : null }))
    .sort((a, b) => b.value - a.value || b.wasted - a.wasted);
}

export const logToday = (log: KitchenLogEntry[], kind: KitchenLogEntry["kind"], now = new Date()) =>
  log.filter((e) => e.kind === kind && new Date(e.created_at).toDateString() === now.toDateString());

// ---------------------------------------------------------------- daily review

export interface Recommendation {
  tone: "rose" | "amber" | "green" | "neutral";
  text: string;
}

export function tomorrowRecommendations(
  model: DemandModel,
  dishes: KitchenDish[],
  log: KitchenLogEntry[],
  tomorrow: number,
  now: number = Date.now(),
): Recommendation[] {
  const recs: Recommendation[] = [];
  const waste = wasteStats(log, 14, now);
  for (const w of waste) {
    if (w.stockouts >= 2) recs.push({ tone: "rose", text: `${w.dish} ran out ${w.stockouts}× in 14 days — raise the opening quantity or the reorder point.` });
    if (w.pct !== null && w.pct >= 15 && w.wasted >= 2) recs.push({ tone: "amber", text: `${w.dish}: ${w.wasted} portions wasted (${w.pct.toFixed(0)}% of cooked) — cook smaller batches.` });
  }
  const active = dishes.filter((d) => d.is_active);
  const ranked = active
    .map((d) => ({ d, x: expectedDay(model, d.id, tomorrow) }))
    .sort((a, b) => b.x - a.x);
  const label = WEEKDAYS.find((w) => w.day === tomorrow)?.label ?? "tomorrow";
  const top = ranked.slice(0, 3).filter((r) => r.x >= 1);
  if (top.length) recs.push({ tone: "green", text: `${label}'s biggest sellers: ${top.map((r) => `${r.d.dish} (~${Math.round(r.x)})`).join(", ")} — prep these first.` });
  const weekendDay = tomorrow === 5 || tomorrow === 6 || tomorrow === 0;
  if (weekendDay && model.serviceDays > 0) recs.push({ tone: "amber", text: `${label} is a busy day — expect noticeably more than midweek; batch the rice, porotta and curries in two rounds.` });
  const dead = active.filter((d) => (model.byDish.get(d.id)?.total ?? 0) === 0);
  if (dead.length && model.serviceDays >= 7) recs.push({ tone: "neutral", text: `No sales recorded for ${dead.map((d) => d.dish).slice(0, 4).join(", ")}${dead.length > 4 ? "…" : ""} — check the item names or drop from the prep list.` });
  if (!recs.length) recs.push({ tone: "neutral", text: "Not enough history yet — log cooked, wasted and stock-out events for a week to unlock tailored advice." });
  return recs;
}

// ---------------------------------------------------------------- weekly

/** Fri+Sat+Sun demand vs Tue–Thu, as a ratio (1.4 = 40% more), all components combined. */
export function weekendLift(model: DemandModel): number | null {
  const dayTotal = (wd: number) => (model.samples[wd] > 0 ? model.totalPerWeekdayHour[wd].reduce((a, b) => a + b, 0) : null);
  const mid = [2, 3, 4].map(dayTotal).filter((x): x is number => x !== null);
  const end = [5, 6, 0].map(dayTotal).filter((x): x is number => x !== null);
  if (!mid.length || !end.length) return null;
  const m = mid.reduce((a, b) => a + b, 0) / mid.length;
  return m > 0 ? end.reduce((a, b) => a + b, 0) / end.length / m : null;
}
