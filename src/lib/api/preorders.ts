// Event preorders: campaigns like Onam Sadhya where guests preorder a fixed
// menu for a specific service date, and dine-in parties have to be fitted into
// hourly seatings with a fixed cover capacity.
//
// The capacity math lives here as pure functions so the view stays dumb and
// the rules stay testable.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { PreorderEvent, PreorderOrder, OrderType } from "@/lib/api/database.types";

const dEvents = demoTable<PreorderEvent>("preorder_events");
const dOrders = demoTable<PreorderOrder>("preorder_orders");

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

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function seedDemoEvent(orgId: string) {
  if (dEvents.list({ org_id: orgId } as Partial<PreorderEvent>).length > 0) return;
  const now = new Date().toISOString();
  const eventId = uid();

  dEvents.insert({
    id: eventId,
    org_id: orgId,
    name: "Onam Sadhya 2026",
    is_active: true,
    service_dates: ["2026-08-22", "2026-08-26", "2026-08-29", "2026-08-30"],
    slot_minutes: 60,
    day_start_hour: 11,
    day_end_hour: 22,
    dine_in_capacity: 20,
    webhook_secret: "demo-secret-not-for-real-use",
    created_at: now,
    updated_at: now,
    created_by: null,
  });

  // Fictional examples only — real guest data never belongs in localStorage.
  const seed = (o: Partial<PreorderOrder>) =>
    dOrders.insert({
      id: uid(),
      org_id: orgId,
      event_id: eventId,
      external_id: null,
      customer_name: "",
      customer_email: null,
      customer_phone: null,
      requested_date: "2026-08-29",
      quantity: 2,
      fulfillment_type: "dine_in",
      timeslot_start: null,
      timeslot_end: null,
      address_street: null,
      address_apartment: null,
      address_city: null,
      address_zip: null,
      addon_qty: 0,
      special_requests: null,
      order_total: 0,
      status: "confirmed",
      raw: {},
      created_at: now,
      updated_at: now,
      created_by: null,
      ...o,
    } as PreorderOrder);

  seed({ customer_name: "Demo Party A", quantity: 6, timeslot_start: "14:00:00", timeslot_end: "15:00:00", order_total: 152.94 });
  seed({ customer_name: "Demo Party B", quantity: 4, order_total: 101.96 });
  seed({ customer_name: "Demo Takeaway", quantity: 3, fulfillment_type: "takeaway", timeslot_start: "13:00:00", order_total: 71.97 });
}

export async function listPreorderEvents(orgId: string): Promise<PreorderEvent[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    seedDemoEvent(orgId);
    return dEvents
      .list({ org_id: orgId } as Partial<PreorderEvent>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("preorder_events")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PreorderEvent[];
}

export async function createPreorderEvent(
  orgId: string,
  patch: Partial<PreorderEvent> & { name: string },
): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    const row = dEvents.insert({
      id: uid(),
      org_id: orgId,
      is_active: true,
      service_dates: [],
      slot_minutes: 60,
      day_start_hour: 11,
      day_end_hour: 22,
      dine_in_capacity: 20,
      webhook_secret: uid(),
      created_at: now,
      updated_at: now,
      created_by: null,
      ...patch,
    } as PreorderEvent);
    return row.id;
  }
  const { data, error } = await getSupabase()
    .from("preorder_events")
    .insert({ org_id: orgId, ...patch })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updatePreorderEvent(
  orgId: string,
  id: string,
  patch: Partial<PreorderEvent>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEvents.update(id, patch);
    return;
  }
  const { error } = await getSupabase()
    .from("preorder_events")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function listPreorderOrders(
  orgId: string,
  eventId: string,
  date?: string,
): Promise<PreorderOrder[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    seedDemoEvent(orgId);
    const filter = { org_id: orgId, event_id: eventId } as Partial<PreorderOrder>;
    return dOrders
      .list(date ? { ...filter, requested_date: date } : filter)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  let q = getSupabase()
    .from("preorder_orders")
    .select("*")
    .eq("org_id", orgId)
    .eq("event_id", eventId);
  if (date) q = q.eq("requested_date", date);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return (data ?? []) as PreorderOrder[];
}

export type NewPreorderOrder = Partial<PreorderOrder> & {
  requested_date: string;
  quantity: number;
  fulfillment_type: OrderType;
};

export async function addPreorderOrder(
  orgId: string,
  eventId: string,
  order: NewPreorderOrder,
): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    const row = dOrders.insert({
      id: uid(),
      org_id: orgId,
      event_id: eventId,
      external_id: null,
      customer_name: "",
      customer_email: null,
      customer_phone: null,
      timeslot_start: null,
      timeslot_end: null,
      address_street: null,
      address_apartment: null,
      address_city: null,
      address_zip: null,
      addon_qty: 0,
      special_requests: null,
      order_total: 0,
      status: "confirmed",
      raw: {},
      created_at: now,
      updated_at: now,
      created_by: null,
      ...order,
    } as PreorderOrder);
    return row.id;
  }
  const { data, error } = await getSupabase()
    .from("preorder_orders")
    .insert({ org_id: orgId, event_id: eventId, ...order })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updatePreorderOrder(
  orgId: string,
  id: string,
  patch: Partial<PreorderOrder>,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(id, { ...patch, updated_at: new Date().toISOString() });
    return;
  }
  const { error } = await getSupabase()
    .from("preorder_orders")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Seat a party. Passing null start clears the seating and returns it to the queue. */
export async function assignTimeslot(
  orgId: string,
  id: string,
  startMin: number | null,
  slotMinutes = 60,
): Promise<void> {
  const patch =
    startMin === null
      ? { timeslot_start: null, timeslot_end: null }
      : {
          timeslot_start: minutesToTime(startMin),
          timeslot_end: minutesToTime(startMin + slotMinutes),
        };
  await updatePreorderOrder(orgId, id, patch);
}

export async function cancelPreorderOrder(orgId: string, id: string): Promise<void> {
  await updatePreorderOrder(orgId, id, { status: "cancelled" });
}

export async function restorePreorderOrder(orgId: string, id: string): Promise<void> {
  await updatePreorderOrder(orgId, id, { status: "confirmed" });
}

export async function deletePreorderOrder(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.remove(id);
    return;
  }
  const { error } = await getSupabase()
    .from("preorder_orders")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

/**
 * Bulk upsert, keyed on (event_id, external_id) — shared by the CSV import and
 * the website webhook, so re-importing the same export or a redelivered
 * submission updates in place instead of duplicating.
 */
export async function importPreorderOrders(
  orgId: string,
  eventId: string,
  rows: NewPreorderOrder[],
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dOrders.list({ org_id: orgId, event_id: eventId } as Partial<PreorderOrder>);
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const hit = row.external_id
        ? existing.find((o) => o.external_id === row.external_id)
        : undefined;
      if (hit) {
        dOrders.update(hit.id, { ...row, updated_at: new Date().toISOString() });
        updated++;
      } else {
        await addPreorderOrder(orgId, eventId, row);
        inserted++;
      }
    }
    return { inserted, updated };
  }

  const sb = getSupabase();
  const keyed = rows.filter((r) => r.external_id);
  const unkeyed = rows.filter((r) => !r.external_id);

  // Which keyed rows already exist, so the caller can report insert vs update.
  let updated = 0;
  if (keyed.length > 0) {
    const { data: existing, error: exErr } = await sb
      .from("preorder_orders")
      .select("external_id")
      .eq("org_id", orgId)
      .eq("event_id", eventId)
      .in("external_id", keyed.map((r) => r.external_id as string));
    if (exErr) throw exErr;
    updated = (existing ?? []).length;

    const { error } = await sb
      .from("preorder_orders")
      .upsert(
        keyed.map((r) => ({ org_id: orgId, event_id: eventId, ...r })),
        { onConflict: "event_id,external_id" },
      );
    if (error) throw error;
  }

  if (unkeyed.length > 0) {
    const { error } = await sb
      .from("preorder_orders")
      .insert(unkeyed.map((r) => ({ org_id: orgId, event_id: eventId, ...r })));
    if (error) throw error;
  }

  return { inserted: keyed.length - updated + unkeyed.length, updated };
}

// ---------------------------------------------------------------------------
// CSV / TSV import
// ---------------------------------------------------------------------------

/**
 * Header aliases, lowercased and stripped of punctuation. Matching on the
 * header row rather than column position is deliberate: the exported sheet has
 * already been rearranged once (address moved after the total), and staff
 * shouldn't have to reorder columns before pasting.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  submitted: ["submission time", "submitted", "date submitted"],
  name: ["name", "customer name", "full name"],
  email: ["email address", "email", "e mail"],
  phone: ["phone number", "phone", "mobile", "telephone"],
  date: ["choose date", "date", "requested date", "service date"],
  quantity: ["number", "number of sadhyas", "quantity", "qty", "covers"],
  fulfillment: ["how would you like to receive your order", "order type", "fulfillment", "type"],
  timeslot: ["timeslot", "time slot", "time", "slot"],
  notes: ["any special requests", "special requests", "notes", "note", "comments"],
  total: ["order total", "total", "amount"],
  street: ["address street address", "address street", "street address", "street"],
  apartment: ["address apartment suite etc", "address apartment", "apartment suite etc", "apartment"],
  city: ["address city", "city", "town"],
  zip: ["address zip postal code", "address zip", "zip postal code", "zip", "postcode", "postal code"],
  addon: ["real leaf addon", "real leaf", "addon", "add on"],
};

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Which of our fields a source column/label refers to, or null if none. */
export function matchField(label: string): string | null {
  const h = canon(label);
  if (!h) return null;
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some((a) => h === a || h.startsWith(a))) return field;
  }
  return null;
}

function mapHeaders(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const field = matchField(raw);
    if (field && !(field in index)) index[field] = i;
  });
  return index;
}

/**
 * Build one order from a bag of label→value pairs.
 *
 * Both ingestion routes land here — the spreadsheet importer (labels are the
 * header row) and the mailbox forwarder (labels are the form's field names in
 * the notification email) — so normalization has exactly one definition.
 */
export function buildOrderFromFields(
  fields: Record<string, string>,
): { row?: NewPreorderOrder; error?: string } {
  const get = (want: string): string => {
    for (const [label, value] of Object.entries(fields)) {
      if (matchField(label) === want) return (value ?? "").trim();
    }
    return "";
  };

  // Email intake can glue a trailing footer onto the last answer, since a
  // boilerplate line has no "Label:" of its own. Numbers therefore read only
  // the first line — a stray signature must never corrupt a cover count.
  const getNum = (want: string): string => get(want).split("\n")[0].trim();

  const name = get("name");
  const date = parseRequestedDate(getNum("date"));
  if (!date) return { error: `couldn't read the date "${get("date")}"` };

  const quantity = Number(getNum("quantity")) || 0;
  if (quantity <= 0) return { error: "quantity must be at least 1" };

  const fulfillment = normalizeFulfillment(get("fulfillment"));
  const slot = parseTimeslot(get("timeslot"));

  return {
    row: {
      customer_name: name,
      customer_email: get("email") || null,
      customer_phone: get("phone") || null,
      requested_date: date,
      quantity,
      fulfillment_type: fulfillment,
      timeslot_start: slot.start,
      // Takeaway has a pickup time, not a seating window.
      timeslot_end: fulfillment === "dine_in" ? slot.end : null,
      address_street: get("street") || null,
      address_apartment: get("apartment") || null,
      address_city: get("city") || null,
      address_zip: get("zip") || null,
      addon_qty: Number(getNum("addon")) || 0,
      special_requests: get("notes") || null,
      order_total: parseMoney(getNum("total")),
    },
  };
}

/** Stable id from the fields a resubmission wouldn't change, so a re-paste of
 *  the same export updates rows instead of duplicating them. */
function synthesizeExternalId(submitted: string, email: string, date: string): string {
  const basis = `${canon(submitted)}|${canon(email)}|${canon(date)}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) {
    h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  }
  return `csv-${(h >>> 0).toString(36)}`;
}

/** "€184.43" | "184,43" | "1.234,56" → 184.43. */
function parseMoney(raw: string): number {
  let s = (raw ?? "").replace(/[^0-9.,-]/g, "").trim();
  if (!s) return 0;
  // German "1.234,56" → strip thousands dots, comma becomes the decimal point.
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export interface ParsedImport {
  rows: NewPreorderOrder[];
  /** Row-level problems, surfaced to the user rather than silently dropped. */
  errors: string[];
  /** Fields the header row didn't cover — usually a truncated copy-paste. */
  missingColumns: string[];
}

/**
 * Parse a tab-separated paste of the website form's export. Tab-separated is
 * what a spreadsheet selection yields on copy, so staff can select rows in
 * Sheets and paste straight in.
 */
export function parseImportRows(text: string): ParsedImport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["Paste the header row plus at least one order."], missingColumns: [] };
  }

  const split = (line: string) => line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
  const index = mapHeaders(split(lines[0]));

  const required = ["name", "date", "quantity", "fulfillment"];
  const missingColumns = required.filter((f) => !(f in index));
  if (missingColumns.length > 0) return { rows: [], errors: [], missingColumns };

  const at = (cells: string[], field: string) =>
    field in index ? (cells[index[field]] ?? "") : "";

  const rows: NewPreorderOrder[] = [];
  const errors: string[] = [];

  // Header index → label bag, so the row builder is shared with email intake.
  const labelFor = Object.fromEntries(
    Object.entries(index).map(([field, i]) => [i, field]),
  ) as Record<number, string>;

  lines.slice(1).forEach((line, i) => {
    const cells = split(line);
    const rowNo = i + 2;

    const fields: Record<string, string> = {};
    cells.forEach((value, col) => {
      const field = labelFor[col];
      if (field) fields[field] = value;
    });

    const name = at(cells, "name");
    const { row, error } = buildOrderFromFields(fields);
    if (error || !row) {
      errors.push(`Row ${rowNo}${name ? ` (${name})` : ""}: ${error}.`);
      return;
    }

    rows.push({
      ...row,
      external_id: synthesizeExternalId(at(cells, "submitted"), at(cells, "email"), at(cells, "date")),
    });
  });

  return { rows, errors, missingColumns };
}
