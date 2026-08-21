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
  buildOrderFromFields,
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


console.log("== Email intake (Gmail forwarder → server mapping) ==");

/**
 * Mirrors extractFields() in the Gmail Apps Script forwarder. Kept in step
 * with it deliberately: the script runs in Google's environment where it
 * can't be tested, so its parsing rules are exercised here instead — most
 * recently rewritten after Kokoland's actual notification email turned out to
 * be a numbered list ("1. Name / Hannah Beeck / 2. Email Address / ...")
 * rather than "Label: value" pairs, which the first version couldn't read at
 * all. "Label: value" is kept as a fallback in case the template changes.
 */
function extractFields(body: string): Record<string, string> {
  const boilerplate = (line: string) => {
    const l = line.trim().toLowerCase();
    return ["you have a new website form submission", "this message was sent", "this email was sent",
            "you are receiving this", "powered by", "sent from", "do not reply", "unsubscribe",
            "--", "___", "==="].some((p) => l.indexOf(p) === 0);
  };

  const lines = String(body || "").split(/\r?\n/);
  // Decided once for the whole email, not line by line — see the .gs comment
  // this mirrors for why per-line detection breaks the pure colon format.
  const numbered = lines.some((l) => /^\s*\d{1,2}[.)]\s+\S/.test(l));

  const fields: Record<string, string> = {};
  let current: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (boilerplate(line)) { current = null; continue; }

    if (numbered) {
      const m = line.match(/^\s*\d{1,2}[.)]\s+(\S.*?)\s*$/);
      if (m) { current = m[1].trim(); fields[current] = ""; }
      else if (current) { fields[current] = fields[current] ? `${fields[current]}\n${line.trim()}` : line.trim(); }
      continue;
    }

    const inline = line.match(/^\s*([^:]{1,60}?)\s*:\s*(.*)$/);
    if (inline) { current = inline[1].trim(); fields[current] = inline[2].trim(); }
    else if (current) { fields[current] = (fields[current] + "\n" + line.trim()).trim(); }
  }
  return fields;
}

// The real notification Kokoland receives (screenshotted from Gmail): a
// numbered list, an unanswered field ("3. Phone Number") shown with nothing
// under it, and — because this order is Takeaway — no Timeslot or Address
// items at all, not even blank ones. entry #117, 21 Aug 2026.
const REAL_NOTIFICATION = [
  "You have a new website form submission:",
  "",
  "1. Name",
  "Hannah Beeck",
  "2. Email Address",
  "hannahbeeck@tutamail.com",
  "3. Phone Number",
  "4. Choose Date",
  "30 August 2026",
  "5. Number",
  "2",
  "6. How would you like to receive your order?",
  "Takeaway",
  "7. Real Leaf addon",
  "2",
  "8. Any special requests?",
  "If possible, no fresh coriander garnish, thank you",
  "9. Order Total",
  "50.98",
  "",
  "---",
  "This message was sent from https://kokoland.de.",
].join("\n");

const realFields = extractFields(REAL_NOTIFICATION);
check("unanswered field parses as blank, not missing the next label",
  realFields["Phone Number"] === "" && "Choose Date" in realFields);
check("omitted fields (Timeslot, Address) are simply absent",
  !("Timeslot" in realFields) && !("Address - Street Address" in realFields));
check("footer after '---' doesn't leak into Order Total",
  realFields["Order Total"] === "50.98", JSON.stringify(realFields["Order Total"]));

const realOrder = buildOrderFromFields(realFields);
check("real notification maps without error", !realOrder.error, realOrder.error || "");
check("real: name", realOrder.row?.customer_name === "Hannah Beeck");
check("real: takeaway, no seating window", realOrder.row?.fulfillment_type === "takeaway" && !realOrder.row?.timeslot_start);
check("real: blank phone stored as null, not empty string", realOrder.row?.customer_phone === null);
check("real: addon and total", realOrder.row?.addon_qty === 2 && realOrder.row?.order_total === 50.98);
check("real: multi-line special request kept whole",
  (realOrder.row?.special_requests || "").includes("no fresh coriander"));

// A real abandoned submission Kokoland has actually received: a guest closed
// the form after entering only name/email. Blank date, blank quantity, no
// fulfillment answered, total "0". This must be rejected with a reason, never
// silently turned into a phantom order — and in the live script it now gets
// labelled "needs review" instead of retried forever every 5 minutes.
const abandoned = buildOrderFromFields(extractFields([
  "1. Name", "Helna James kuttickattu",
  "2. Email Address", "helnajames91@gmail.co",
  "3. Phone Number",
  "4. Choose Date",
  "5. Number",
  "6. How would you like to receive your order?", "Takeaway",
  "9. Order Total", "0",
].join("\n")));
check("abandoned submission is rejected with a reason, not silently zeroed",
  !!abandoned.error && !abandoned.row, JSON.stringify(abandoned));

// The same awkward cases as the spreadsheet path, arriving by email instead —
// via the numbered-list format this time, since that's what's actually sent.
const takeawayMail = buildOrderFromFields(extractFields(
  "1. Name\nRanjani\n2. Choose Date\n26 August 2026\n3. Number\n2\n" +
  "4. How would you like to receive your order?\nTakeaway\n5. Timeslot\n14\n6. Real Leaf addon\n3"));
check("emailed takeaway keeps pickup, gets no seating window",
  takeawayMail.row?.timeslot_start === "14:00:00" && takeawayMail.row?.timeslot_end === null);

const offGridMail = buildOrderFromFields(extractFields(
  "1. Name\nJicksy\n2. Choose Date\n29 August 2026\n3. Number\n5\n" +
  "4. How would you like to receive your order?\nDine-in\n5. Timeslot\n11:30-12:30"));
check("emailed off-grid booking keeps its real window",
  offGridMail.row?.timeslot_start === "11:30:00" && offGridMail.row?.timeslot_end === "12:30:00");

check("emailed unreadable date is rejected, not guessed",
  !!buildOrderFromFields(extractFields(
    "1. Name\nX\n2. Choose Date\nwhenever\n3. Number\n2\n" +
    "4. How would you like to receive your order?\nDine in")).error);

// "Label: value" is still accepted, in case the notification template changes.
check("inline colon format still works as a fallback",
  buildOrderFromFields(extractFields(
    "Name: Fallback Guest\nChoose Date: 22 August 2026\nNumber: 3\n" +
    "How would you like to receive your order?: Dine in")).row?.customer_name === "Fallback Guest");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
