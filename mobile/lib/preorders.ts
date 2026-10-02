// Event preorders — the pure parts: time handling and the seating-capacity maths, ported unchanged from the
// website's src/lib/api/preorders.ts so a party is "full" on the phone exactly when it is on the web.

import type { PreorderEvent, PreorderOrder, OrderType } from "@/lib/types";

// ---------------------------------------------------------------------------
// Normalization — the messy edges of the website form live here, and nowhere
// else. Both the CSV import and the webhook route go through these, so the
// rest of the app only ever sees clean times and a canonical order type.
// ---------------------------------------------------------------------------

/** "Dine in", "Dine-in", "dine_in" → "dine_in". Anything else → "takeaway". */
export function normalizeFulfillment(raw: string | null | undefined): OrderType {
  const s = (raw ?? "").toLowerCase().replace(/[\s-]/g, "");
  if (s === "dinein") return "dine_in";
  if (s === "delivery") return "delivery";
  return "takeaway";
}

/** "14:00" | "14" | "9.30" → minutes since midnight, or null. */
function parseClock(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes since midnight → "HH:MM:SS", the shape Postgres `time` wants. */
export function minutesToTime(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}:00`;
}

/** "HH:MM:SS" → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

/** "14:00:00" → "14:00" for display. */
export function formatTime(t: string): string {
  return t.slice(0, 5);
}

/**
 * The form's Timeslot field, in every shape it actually arrives in:
 *   "14-15"        → 14:00–15:00   (the normal hourly option)
 *   "11:30-12:30"  → 11:30–12:30   (a time negotiated by phone)
 *   "14"           → 14:00, no end (a takeaway pickup time)
 *   ""             → not placed yet
 * `end` is only inferred for a range; a bare time never invents a duration.
 */
export function parseTimeslot(
  raw: string | null | undefined,
): { start: string | null; end: string | null } {
  const s = (raw ?? "").trim();
  if (!s) return { start: null, end: null };

  const parts = s.split(/[-–—]/);
  const start = parseClock(parts[0] ?? "");
  if (start === null) return { start: null, end: null };
  if (parts.length < 2) return { start: minutesToTime(start), end: null };

  const end = parseClock(parts[1] ?? "");
  return {
    start: minutesToTime(start),
    end: end === null ? null : minutesToTime(end),
  };
}

/** "29 August 2026" | "2026-08-29" → "2026-08-29". Null when unparseable. */
export function parseRequestedDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = new Date(`${s} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export interface SlotParty {
  order: PreorderOrder;
  /** True when the booking isn't hour-aligned, so it shows in more than one
   *  row. The grid marks these so 9 covers across two rows don't read as 18. */
  isException: boolean;
}

export interface HourSlot {
  /** Slot start, minutes since midnight. */
  startMin: number;
  /** "14:00 – 15:00" */
  label: string;
  /** Covers occupying this hour. */
  booked: number;
  capacity: number;
  remaining: number;
  state: "empty" | "ok" | "near" | "full" | "over";
  parties: SlotParty[];
}

/** Half-open overlap: a booking ending exactly at 15:00 doesn't touch 15:00. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Orders that consume seats: dine-in, confirmed, on this date, and placed. */
function seatedOrders(orders: PreorderOrder[]): PreorderOrder[] {
  return orders.filter(
    (o) =>
      o.status === "confirmed" &&
      o.fulfillment_type === "dine_in" &&
      o.timeslot_start !== null,
  );
}

/**
 * Per-hour occupancy for one service date.
 *
 * A booking counts its full covers against every hour it overlaps. For an
 * off-grid booking like 11:30–12:30 that means both 11:00 and 12:00 — those
 * seats really are occupied during part of each, so the count can only ever
 * under-fill a slot, never let one be overbooked.
 */
export function computeHourCapacity(
  event: PreorderEvent,
  ordersForDate: PreorderOrder[],
): HourSlot[] {
  const seated = seatedOrders(ordersForDate);
  const slots: HourSlot[] = [];

  for (let h = event.day_start_hour; h < event.day_end_hour; h++) {
    const startMin = h * 60;
    const endMin = startMin + event.slot_minutes;

    const parties: SlotParty[] = [];
    let booked = 0;

    for (const o of seated) {
      const oStart = timeToMinutes(o.timeslot_start!);
      // A booking with no end occupies the one slot it starts in.
      const oEnd = o.timeslot_end ? timeToMinutes(o.timeslot_end) : oStart + event.slot_minutes;
      if (!overlaps(oStart, oEnd, startMin, endMin)) continue;
      booked += o.quantity;
      parties.push({
        order: o,
        isException: oStart % event.slot_minutes !== 0 || oEnd - oStart !== event.slot_minutes,
      });
    }

    const capacity = event.dine_in_capacity;
    const remaining = capacity - booked;
    const pct = capacity > 0 ? booked / capacity : 0;
    const state: HourSlot["state"] =
      booked === 0 ? "empty"
      : booked > capacity ? "over"
      : booked === capacity ? "full"
      : pct >= 0.7 ? "near"
      : "ok";

    slots.push({
      startMin,
      label: `${pad(h)}:00 – ${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
      booked,
      capacity,
      remaining,
      state,
      parties,
    });
  }

  return slots;
}

/**
 * Hours that can still take a party of `size` — what the assign picker offers.
 * Whole hours only: off-grid times exist in the data but are never created.
 */
export function hoursWithRoom(
  event: PreorderEvent,
  ordersForDate: PreorderOrder[],
  size: number,
  /** Ignore this order's own seats, so re-seating a placed party isn't blocked by itself. */
  excludeOrderId?: string,
): HourSlot[] {
  const pool = excludeOrderId ? ordersForDate.filter((o) => o.id !== excludeOrderId) : ordersForDate;
  return computeHourCapacity(event, pool).filter((s) => s.remaining >= size);
}

/** Dine-in parties on this date with no seating time yet — the work queue. */
export function unassignedParties(ordersForDate: PreorderOrder[]): PreorderOrder[] {
  return ordersForDate.filter(
    (o) => o.status === "confirmed" && o.fulfillment_type === "dine_in" && !o.timeslot_start,
  );
}

export interface DayTotals {
  orders: number;
  covers: number;
  coversSeated: number;
  coversUnplaced: number;
  takeawayOrders: number;
  takeawayCovers: number;
  revenue: number;
}

export function computeDayTotals(ordersForDate: PreorderOrder[]): DayTotals {
  const live = ordersForDate.filter((o) => o.status === "confirmed");
  const dineIn = live.filter((o) => o.fulfillment_type === "dine_in");
  const takeaway = live.filter((o) => o.fulfillment_type !== "dine_in");
  const sum = (rows: PreorderOrder[], f: (o: PreorderOrder) => number) =>
    rows.reduce((n, o) => n + f(o), 0);

  return {
    orders: live.length,
    covers: sum(live, (o) => o.quantity),
    coversSeated: sum(dineIn.filter((o) => o.timeslot_start), (o) => o.quantity),
    coversUnplaced: sum(dineIn.filter((o) => !o.timeslot_start), (o) => o.quantity),
    takeawayOrders: takeaway.length,
    takeawayCovers: sum(takeaway, (o) => o.quantity),
    revenue: sum(live, (o) => Number(o.order_total) || 0),
  };
}
