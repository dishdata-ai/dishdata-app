// Preorder capacity self-check: the import parser and the seating math.
// Run: npx tsx scripts/preorders-selfcheck.ts
//
// The fixtures are the real Onam Sadhya 2026 shapes that broke earlier
// assumptions — an off-grid 11:30–12:30 booking, a bare "14" takeaway pickup
// time, and "Dine-in" vs "Dine in" spelling — so a regression here is a
// regression against orders the restaurant has actually taken.

import {
  parseTimeslot, normalizeFulfillment, parseRequestedDate, parseImportRows,
  computeHourCapacity, computeDayTotals, unassignedParties, hoursWithRoom,
} from "../src/lib/api/preorders";
import type { PreorderEvent, PreorderOrder } from "../src/lib/api/database.types";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) { failures++; console.error(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log("== Timeslot parsing ==");
check("hourly range 14-15", same(parseTimeslot("14-15"), { start: "14:00:00", end: "15:00:00" }));
check("off-grid 11:30-12:30", same(parseTimeslot("11:30-12:30"), { start: "11:30:00", end: "12:30:00" }));
check("bare pickup time 14 has no end", same(parseTimeslot("14"), { start: "14:00:00", end: null }));
check("blank → unplaced", same(parseTimeslot(""), { start: null, end: null }));
check("garbage → unplaced", same(parseTimeslot("whenever"), { start: null, end: null }));
check("out-of-range hour rejected", same(parseTimeslot("99"), { start: null, end: null }));

console.log("== Fulfillment + date normalization ==");
check('"Dine in" → dine_in', normalizeFulfillment("Dine in") === "dine_in");
check('"Dine-in" → dine_in', normalizeFulfillment("Dine-in") === "dine_in");
check('"Takeaway" → takeaway', normalizeFulfillment("Takeaway") === "takeaway");
check("blank defaults to takeaway", normalizeFulfillment("") === "takeaway");
check('"29 August 2026"', parseRequestedDate("29 August 2026") === "2026-08-29");
check("ISO passes through", parseRequestedDate("2026-08-30") === "2026-08-30");

console.log("== Import parser (export column order) ==");
const HEADER = [
  "Submission Time", "Name", "Email Address", "Phone Number", "Choose Date", "Number",
  "How would you like to receive your order?", "Timeslot", "Any special requests?",
  "Order Total", "Address - Street Address", "Address - Apartment, suite, etc",
  "Address - City", "Address - ZIP / Postal Code", "Real Leaf addon",
].join("\t");
const ROWS = [
  ["Aug 20, 2026 @ 7:43 PM", "Shaleena Ann Thomas", "a@example.com", "15205923283", "29 August 2026", "7", "Dine in", "14-15", "kids seat please", "184.43", "Ilmenauer Str 2", "", "Berlin", "14193", "7"],
  ["Aug 19, 2026 @ 1:56 PM", "Jicksy John", "b@example.com", "17687249155", "29 August 2026", "5", "Dine-in", "11:30-12:30", "", "119.95", "", "", "", "", ""],
  ["Aug 19, 2026 @ 10:50 AM", "Ranjani Krishnan", "c@example.com", "17620179716", "26 August 2026", "2", "Takeaway", "14", "deliver?", "56.98", "Barnimblick 40", "", "Ahrensfelde", "16356", "3"],
  ["Aug 20, 2026 @ 2:11 PM", "Hamed Khalidi", "d@example.com", "1628743786", "29 August 2026", "2", "Dine in", "", "", "56.98", "Ritterstr 53", "", "Berlin", "10969", "2"],
].map((r) => r.join("\t"));
const parsed = parseImportRows([HEADER, ...ROWS].join("\n"));
check("no row errors", parsed.errors.length === 0, parsed.errors.join("; "));
check("no missing columns", parsed.missingColumns.length === 0, parsed.missingColumns.join(","));
check("all rows parsed", parsed.rows.length === 4);
check("off-grid dine-in keeps its real window",
  same([parsed.rows[1].timeslot_start, parsed.rows[1].timeslot_end], ["11:30:00", "12:30:00"]));
check("takeaway keeps pickup, gets no seating window",
  same([parsed.rows[2].fulfillment_type, parsed.rows[2].timeslot_start, parsed.rows[2].timeslot_end],
       ["takeaway", "14:00:00", null]));
check("no timeslot → unplaced", parsed.rows[3].timeslot_start === null);
check("money and addon parsed", parsed.rows[0].order_total === 184.43 && parsed.rows[0].addon_qty === 7);
check("address captured", parsed.rows[0].address_city === "Berlin");

// Re-pasting the same export must update rows, never duplicate them.
const again = parseImportRows([HEADER, ...ROWS].join("\n"));
check("external ids are stable across pastes",
  same(parsed.rows.map((r) => r.external_id), again.rows.map((r) => r.external_id)));
check("external ids are distinct per row",
  new Set(parsed.rows.map((r) => r.external_id)).size === parsed.rows.length);

// Reordered columns must still map, since the export layout has changed before.
const SWAPPED = ["Name", "Choose Date", "Number", "How would you like to receive your order?", "Timeslot"].join("\t");
const swapped = parseImportRows([SWAPPED, ["Meghna", "29 August 2026", "4", "Dine in", ""].join("\t")].join("\n"));
check("header-driven mapping survives reordering",
  swapped.errors.length === 0 && swapped.rows[0]?.quantity === 4);
check("bad quantity is reported, not silently dropped",
  parseImportRows([SWAPPED, ["X", "29 August 2026", "0", "Dine in", ""].join("\t")].join("\n")).errors.length === 1);
check("unreadable date is reported",
  parseImportRows([SWAPPED, ["X", "someday", "2", "Dine in", ""].join("\t")].join("\n")).errors.length === 1);

console.log("== Seating capacity (Onam Sadhya, 29 Aug) ==");
const event = {
  day_start_hour: 11, day_end_hour: 22, slot_minutes: 60, dine_in_capacity: 20,
} as PreorderEvent;
const party = (name: string, qty: number, start: string | null, end: string | null,
               type = "dine_in", status = "confirmed") => ({
  id: name, customer_name: name, quantity: qty, timeslot_start: start, timeslot_end: end,
  fulfillment_type: type, status, order_total: 0,
} as unknown as PreorderOrder);

const aug29 = [
  party("Shaleena", 7, "14:00:00", "15:00:00"),
  party("Jicksy A", 5, "11:30:00", "12:30:00"),
  party("Jicksy B", 4, "11:30:00", "12:30:00"),
  party("Hamed", 2, null, null),
  party("Victor", 2, null, null),
  party("Sneha", 7, null, null),
  party("Meghna", 4, null, null),
];
const hour = (orders: PreorderOrder[], h: number) =>
  computeHourCapacity(event, orders).find((s) => s.startMin === h * 60)!;

// The off-grid booking occupies part of both hours, so it counts against both.
check("11:00 holds the 9 off-grid covers", hour(aug29, 11).booked === 9);
check("12:00 holds the same 9 covers", hour(aug29, 12).booked === 9);
check("off-grid parties are flagged as exceptions",
  hour(aug29, 11).parties.every((p) => p.isException));
check("hour-aligned parties are not flagged",
  hour(aug29, 14).parties.every((p) => !p.isException));
check("a 14:00–15:00 booking leaves 15:00 free", hour(aug29, 15).booked === 0);
check("untouched hours read empty", hour(aug29, 13).state === "empty");

const totals = computeDayTotals(aug29);
check("31 covers on the day", totals.covers === 31);
check("16 seated", totals.coversSeated === 16);
check("15 still to place", totals.coversUnplaced === 15);
check("unassigned queue matches", unassignedParties(aug29).reduce((n, o) => n + o.quantity, 0) === 15);

console.log("== Overbooking guards ==");
const full = [...aug29, party("Walk-up", 13, "14:00:00", "15:00:00")];
check("exactly at capacity reads full", hour(full, 14).state === "full" && hour(full, 14).booked === 20);
check("a full hour is never offered", !hoursWithRoom(event, full, 1).some((s) => s.startMin === 14 * 60));
check("over capacity is flagged",
  hour([...aug29, party("Huge", 15, "14:00:00", "15:00:00")], 14).state === "over");
check("picker offers an hour that fits the party", hoursWithRoom(event, aug29, 7).some((s) => s.startMin === 13 * 60));
check("picker hides an hour that cannot fit the party", !hoursWithRoom(event, aug29, 12).some((s) => s.startMin === 11 * 60));
check("re-seating a party isn't blocked by its own seats",
  hoursWithRoom(event, aug29, 7, "Shaleena").some((s) => s.startMin === 14 * 60));

console.log("== Exclusions ==");
check("cancelled orders free their seats",
  hour([party("Gone", 20, "14:00:00", "15:00:00", "dine_in", "cancelled")], 14).booked === 0);
check("takeaway never consumes seats",
  hour([party("Pickup", 20, "14:00:00", null, "takeaway")], 14).booked === 0);
check("cancelled orders leave the day totals",
  computeDayTotals([party("Gone", 9, null, null, "dine_in", "cancelled")]).covers === 0);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
