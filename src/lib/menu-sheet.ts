import { isSoldOut } from "@/lib/calc";
import { orderCategories } from "@/lib/category-order";
import type { Recipe } from "@/lib/api/database.types";

/**
 * "Today's menu" as a printable sheet.
 *
 * The whole point of this is that it is NOT a second thing to maintain. The
 * kitchen already hides items (`is_active`) and marks them sold out
 * (`sold_out_until`) every day so the POS and the QR menu stay honest — this
 * derives the printed sheet from exactly that same state, so the paper on the
 * table can never disagree with the till.
 */

export interface SheetItem {
  name: string;
  /** null when the item is priced on the day (drinks selection, market fish). */
  price: number | null;
  description: string | null;
}

export interface SheetSection {
  category: string;
  items: SheetItem[];
  /** True when this is the tail of a section carried over from the previous column. */
  continued?: boolean;
  /**
   * False only for a continuation that landed on the SAME page as its head
   * (same page, next column) — repeating "Salads" right below "Salads" with
   * nothing between them reads as a duplicate, not a continuation. A
   * continuation that crossed an actual page boundary keeps its heading;
   * that's the one case a reader needs it to know what they're looking at.
   * Undefined/true for every ordinary (non-continued) section.
   */
  headingVisible?: boolean;
}

/** One printed page: two columns of whole (or deliberately carried-over) sections. */
export type SheetPage = [SheetSection[], SheetSection[]];

/**
 * Layout costs in millimetres, matching the type sizes in MenuSheet.tsx.
 *
 * Pagination is estimated from these rather than measured from the DOM: the
 * sheet has to paginate identically in the on-screen preview and in the print
 * output, and measurement inside a transform-scaled preview is exactly where
 * that agreement breaks down. The numbers are deliberately a shade generous —
 * ending a column early is invisible, overflowing one is not.
 *
 * A flat per-item height (the original approach here) assumed every dish name
 * and every description sat on exactly one wrapped line. Real menu text
 * doesn't: a long name ("Porotta with Kerala Chicken Curry (with Bone)")
 * wraps to two, and a full-sentence description commonly wraps to three or
 * four in an 85mm column. Undercounting that let a column's real content run
 * past the page it was estimated to fit in. These constants are calibrated
 * against real rendered text (see the git history of this file for the
 * measurements).
 *
 * The first calibration pass used the tightest wrap observed (~46 chars/line)
 * as the chars-per-line figure for every item, which is safe but was a
 * systematic ~35% overestimate against the real average (~57) — it printed
 * overflow-free but wasted roughly a third of every page. DESC_CHARS_PER_LINE
 * is now the real average; DESC_SAFETY covers the boundary cases a flat
 * average can't (a description landing right at a wrap threshold) without
 * inflating every item by a full extra line the way the conservative figure
 * did.
 */
const HEADING_H = 11; // real h3 + underline block measured ~9.85mm

const SECTION_GAP = 7;

const NAME_CHARS_PER_LINE = 35; // real one-line/two-line boundary measured at 36-39 chars
const NAME_LINE_H = 4.65; // mm, one line of the 10.5pt name/price row
const DESC_CHARS_PER_LINE = 57; // real measured average across sampled descriptions
const DESC_LINE_H = 3.9; // mm, one wrapped line of the 8pt description
const DESC_BASE = 3.9; // mm, description's own top margin + leading overshoot above its first line
const DESC_SAFETY = 2; // mm, covers a description landing right at a wrap boundary
const ITEM_MARGIN_WITH_DESC = 2.4; // mm, li's mb-[2.4mm]
const ITEM_MARGIN_NO_DESC = 1.7; // mm, li's mb-[1.7mm]

const PAGE_H = 297;
const PAD_Y = 22; // 12mm top + 10mm bottom
const HEADER_FIRST = 50; // logo, date and the "Today's Menu" title block
const HEADER_CONT = 16; // slim running header on later pages

// Only the LAST printed page carries the tagline/"available today"/allergen
// footer (see MenuSheet.tsx) — every other page just prints a slim "n/total"
// corner mark. Reserving the full footer on every page wasted real column
// space on anything but the final page; FOOTER_SLIM is that page-number
// line's own height (margin + one 8pt line).
const FOOTER_LAST = 24;
const FOOTER_SLIM = 10;

// Character-count line estimates are an average, not a measurement — a
// column already packed near 100% full can tip over when the same content
// prints in a language whose words happen to run longer (German routinely
// does), crossing a line-wrap boundary the English text didn't. The page is
// a fixed 297mm with overflow hidden, so going over isn't cosmetic — it's
// content silently missing off the bottom. This trims usable capacity a
// little so a column that's *just barely* full always keeps some slack,
// rather than only being safe for whichever language it happened to be
// calibrated against.
const SAFETY_MARGIN = 6;

export type SheetLang = "en" | "de";

/**
 * Wording that belongs to the sheet itself rather than to any dish.
 *
 * Only the fixed furniture is translated here — dish names, descriptions and
 * category labels come from the recipe's own `*_de` columns, so a German sheet
 * shows exactly the German the kitchen wrote and silently falls back to the
 * English for anything not translated yet, rather than printing a blank.
 */
export const SHEET_STRINGS: Record<SheetLang, {
  title: string;
  stocks: string;
  footnote: string;
  continued: string;
}> = {
  en: {
    title: "Today's Menu",
    stocks: "Available today while stocks last",
    footnote: "Please ask our team about allergens and dietary requirements.",
    continued: "(cont.)",
  },
  de: {
    title: "Tageskarte",
    stocks: "Heute verfügbar, solange der Vorrat reicht",
    footnote: "Bitte sprechen Sie unser Team auf Allergene und Ernährungswünsche an.",
    continued: "(Fortsetzung)",
  },
};

export function isAvailableToday(r: Pick<Recipe, "is_active" | "sold_out_until">): boolean {
  return r.is_active && !isSoldOut(r);
}

/**
 * Group today's available recipes into printable sections.
 *
 * `categoryOrder` is the restaurant's own explicit order (see
 * category-order.ts), matched against each recipe's English `category` even
 * on a German sheet — a manager arranges the order once, in whichever
 * language they set categories up in, and it holds regardless of which
 * language the sheet is printed in.
 */
export function buildSections(
  recipes: Recipe[],
  {
    withDescriptions = false,
    lang = "en",
    categoryOrder,
  }: { withDescriptions?: boolean; lang?: SheetLang; categoryOrder?: string[] | null } = {},
): SheetSection[] {
  const order: string[] = []; // English category, for ordering
  const displayOf = new Map<string, string>(); // English category -> display label
  const byCategory = new Map<string, SheetItem[]>(); // keyed by English category

  // German falls back to English field by field, so a half-translated menu
  // prints the translations that exist rather than gaps where they don't.
  const de = lang === "de";
  const pick = (german: string | null, english: string) => (de && german ? german : english);

  // Oldest-first, as a stable base order before categoryOrder is applied.
  for (const r of [...recipes].reverse()) {
    if (!isAvailableToday(r)) continue;
    const englishCategory = (r.category || "Weitere").trim();
    if (!byCategory.has(englishCategory)) {
      byCategory.set(englishCategory, []);
      order.push(englishCategory);
    }
    // Group strictly by the English category (every recipe in "Beverages"
    // lands together, however each one's category_de is set), but let the
    // heading upgrade to a real translation the moment any recipe in the
    // group supplies one — one untranslated stray item shouldn't fall the
    // whole category back to English, and previously worse: keying the
    // group itself by the first-seen display label silently orphaned every
    // recipe whose category_de disagreed with that first one.
    const display = pick(r.category_de, englishCategory).trim();
    if (!displayOf.has(englishCategory) || (de && r.category_de && displayOf.get(englishCategory) === englishCategory)) {
      displayOf.set(englishCategory, display);
    }
    const description = withDescriptions
      ? pick(r.description_de, r.description || "").trim() || null
      : null;
    byCategory.get(englishCategory)!.push({
      name: pick(r.name_de, r.name).trim(),
      // A zero price means "ask us" rather than "free" — printing "0.00 €"
      // on a menu is worse than printing nothing at all.
      price: r.price > 0 ? r.price : null,
      description,
    });
  }

  return orderCategories(order, categoryOrder).map((englishCategory) => {
    const display = displayOf.get(englishCategory)!;
    return { category: display, items: byCategory.get(englishCategory)! };
  });
}

function itemHeight(item: SheetItem): number {
  const nameLines = Math.max(1, Math.ceil(item.name.length / NAME_CHARS_PER_LINE));
  let h = nameLines * NAME_LINE_H;
  if (item.description) {
    const descLines = Math.max(1, Math.ceil(item.description.length / DESC_CHARS_PER_LINE));
    h += DESC_BASE + descLines * DESC_LINE_H + DESC_SAFETY + ITEM_MARGIN_WITH_DESC;
  } else {
    h += ITEM_MARGIN_NO_DESC;
  }
  return h;
}

const sectionHeight = (s: SheetSection) =>
  HEADING_H + s.items.reduce((h, i) => h + itemHeight(i), 0) + SECTION_GAP;

/** Usable column height for the nth page (0-based), given which footer it reserves. */
function columnHeight(pageIndex: number, footer: number): number {
  return PAGE_H - PAD_Y - (pageIndex === 0 ? HEADER_FIRST : HEADER_CONT) - footer - SAFETY_MARGIN;
}

/**
 * Flow sections into two-column pages, reserving the full footer only from
 * `fullFooterFrom` (a page index) onward — everything before it gets the slim
 * page-number reserve instead. `paginate()` below calls this twice: once
 * assuming no page is final (to find out how many pages the content actually
 * needs), then again reserving the real footer on the page that turns out to
 * be last. If that guess is ever off, the presumed-last page (and anything
 * pushed past it) still gets the full, safe reserve — it can only end up with
 * more pages than truly needed, never an overflowing one.
 */
function paginateOnce(sections: SheetSection[], fullFooterFrom: number): SheetPage[] {
  const pages: SheetPage[] = [];
  let page: SheetPage = [[], []];
  let col = 0;
  let used = 0;
  // Set only when nextColumn() actually starts a new PAGE (col 0 -> 1 within
  // a page doesn't count). Consulted the moment a continuation is placed,
  // then cleared — a continued section's heading shows only if a real page
  // boundary sits between it and its head.
  let crossedPage = false;

  const nextColumn = () => {
    if (col === 0) {
      col = 1;
    } else {
      pages.push(page);
      page = [[], []];
      col = 0;
      crossedPage = true;
    }
    used = 0;
  };

  const queue = [...sections];
  while (queue.length) {
    const section = queue.shift()!;
    const pageIndex = pages.length;
    const footer = pageIndex >= fullFooterFrom ? FOOTER_LAST : FOOTER_SLIM;
    const capacity = columnHeight(pageIndex, footer);
    const remaining = capacity - used;

    if (sectionHeight(section) <= remaining) {
      page[col].push(section.continued ? { ...section, headingVisible: crossedPage } : section);
      used += sectionHeight(section);
      crossedPage = false;
      continue;
    }

    // Doesn't fit whole. A partially-used column with real space left should
    // still take what fits rather than sit blank while the whole section
    // waits for a fresh column — leaving exactly that space empty, every
    // time a section's size didn't happen to align with what was left, is
    // what made printed sheets look sparse (confirmed against a real print:
    // roughly half of two separate pages sat blank below a short section).
    //
    // Skip straight to a fresh column only when there's not even room for
    // the heading plus the smallest item here — splitting there would strand
    // a heading alone at the bottom of a column with nothing under it, which
    // reads worse than the blank space it would save. Checked against the
    // smallest item, not just the first: a long name sitting first in the
    // list (e.g. one long drink name before nine short ones) doesn't mean
    // nothing in the section fits — see the loop below, which is the part
    // that actually decides what does.
    const smallestItemHeight = Math.min(...section.items.map(itemHeight));
    const worthSplittingHere = remaining >= HEADING_H + smallestItemHeight + SECTION_GAP;
    if (used > 0 && !worthSplittingHere) {
      nextColumn();
      queue.unshift(section);
      continue;
    }

    // Collect whichever items fit, in their original order — not just a
    // prefix. A section is a fixed list (Beverages, say), and printing it
    // out of order would read as a mistake, so the tail below still prints
    // every deferred item in exactly the relative order it had here. But
    // stopping at the *first* item that doesn't fit wasted real room: one
    // long name blocked nine short ones behind it from ever being tried,
    // even though several would have fit in the space that name couldn't.
    const head: SheetItem[] = [];
    const tail: SheetItem[] = [];
    let h = HEADING_H;
    for (const item of section.items) {
      // + SECTION_GAP: a split section still pays the same trailing gap a
      // whole one does once it's actually placed (see the `used +=` below),
      // so a candidate item only belongs in `head` if there's room for it
      // *and* that gap — checking against `remaining` without the gap let
      // this loop accept one item more than the column actually had space
      // for, silently overflowing the page's fixed, overflow-hidden height.
      if (h + itemHeight(item) + SECTION_GAP <= remaining) {
        head.push(item);
        h += itemHeight(item);
      } else {
        tail.push(item);
      }
    }
    // Guard against a pathological capacity leaving no room at all: always
    // place at least one item (the smallest, to minimize how far this
    // overflows) so the loop cannot spin forever.
    if (!head.length) {
      const smallest = section.items.reduce((a, b) => (itemHeight(b) < itemHeight(a) ? b : a));
      head.push(smallest);
      tail.splice(tail.indexOf(smallest), 1);
    }

    page[col].push(
      section.continued ? { ...section, items: head, headingVisible: crossedPage } : { ...section, items: head },
    );
    // Actual height consumed, not the whole column — a split rarely uses
    // every last millimetre of what was available, and the old flat
    // `used = capacity` threw that leftover away too, on top of the gap
    // above. The next item in the queue gets a fair shot at whatever's left.
    // `+ SECTION_GAP` matters here: sectionHeight() always includes it, so
    // omitting it made every split under-count its own footprint by 7mm —
    // the tracker believed there was more room left than truly existed,
    // letting later sections get packed into space that was already spoken
    // for.
    used += h + SECTION_GAP;
    crossedPage = false;
    if (tail.length) queue.unshift({ ...section, items: tail, continued: true });
  }

  if (page[0].length || page[1].length) pages.push(page);
  return pages.length ? pages : [[[], []]];
}

/**
 * Flow sections into two-column pages.
 *
 * Sections are kept whole wherever they fit — a category chopped in half reads
 * as two unrelated categories. One that genuinely cannot fit a single column is
 * carried over with its heading repeated, which is the normal typographic
 * convention and much better than letting it run off the page.
 */
export function paginate(sections: SheetSection[]): SheetPage[] {
  const optimistic = paginateOnce(sections, Infinity);
  return paginateOnce(sections, optimistic.length - 1);
}

/** German-format date for the sheet header, pinned to Berlin like the receipts. */
export function sheetDate(d: Date = new Date()): string {
  return d.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
