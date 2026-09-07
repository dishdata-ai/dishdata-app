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
 * measurements) with the chars-per-line figures deliberately conservative —
 * biased toward predicting one more wrapped line than a given string usually
 * needs, never one fewer.
 */
const HEADING_H = 12.5;
const SECTION_GAP = 7;

const NAME_CHARS_PER_LINE = 34; // real one-line/two-line boundary measured at 36-39 chars
const NAME_LINE_H = 4.65; // mm, one line of the 10.5pt name/price row
const DESC_CHARS_PER_LINE = 42; // real tightest-wrap case implied ~46 chars/line
const DESC_LINE_H = 3.9; // mm, one wrapped line of the 8pt description
const DESC_BASE = 3.9; // mm, description's own top margin + leading overshoot above its first line
const ITEM_MARGIN_WITH_DESC = 2.4; // mm, li's mb-[2.4mm]
const ITEM_MARGIN_NO_DESC = 1.7; // mm, li's mb-[1.7mm]

const PAGE_H = 297;
const PAD_Y = 22; // 12mm top + 10mm bottom
const HEADER_FIRST = 50; // logo, date and the "Today's Menu" title block
const HEADER_CONT = 16; // slim running header on later pages
const FOOTER = 24; // reserved on every page, so the last one always has room

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
  const byCategory = new Map<string, SheetItem[]>(); // keyed by display label

  // German falls back to English field by field, so a half-translated menu
  // prints the translations that exist rather than gaps where they don't.
  const de = lang === "de";
  const pick = (german: string | null, english: string) => (de && german ? german : english);

  // Oldest-first, as a stable base order before categoryOrder is applied.
  for (const r of [...recipes].reverse()) {
    if (!isAvailableToday(r)) continue;
    const englishCategory = (r.category || "Weitere").trim();
    const display = pick(r.category_de, englishCategory).trim();
    if (!byCategory.has(display)) {
      byCategory.set(display, []);
      if (!displayOf.has(englishCategory)) {
        displayOf.set(englishCategory, display);
        order.push(englishCategory);
      }
    }
    const description = withDescriptions
      ? pick(r.description_de, r.description || "").trim() || null
      : null;
    byCategory.get(display)!.push({
      name: pick(r.name_de, r.name).trim(),
      // A zero price means "ask us" rather than "free" — printing "0.00 €"
      // on a menu is worse than printing nothing at all.
      price: r.price > 0 ? r.price : null,
      description,
    });
  }

  return orderCategories(order, categoryOrder).map((englishCategory) => {
    const display = displayOf.get(englishCategory)!;
    return { category: display, items: byCategory.get(display)! };
  });
}

function itemHeight(item: SheetItem): number {
  const nameLines = Math.max(1, Math.ceil(item.name.length / NAME_CHARS_PER_LINE));
  let h = nameLines * NAME_LINE_H;
  if (item.description) {
    const descLines = Math.max(1, Math.ceil(item.description.length / DESC_CHARS_PER_LINE));
    h += DESC_BASE + descLines * DESC_LINE_H + ITEM_MARGIN_WITH_DESC;
  } else {
    h += ITEM_MARGIN_NO_DESC;
  }
  return h;
}

const sectionHeight = (s: SheetSection) =>
  HEADING_H + s.items.reduce((h, i) => h + itemHeight(i), 0) + SECTION_GAP;

/** Usable column height for the nth page (0-based). */
function columnHeight(pageIndex: number): number {
  return PAGE_H - PAD_Y - (pageIndex === 0 ? HEADER_FIRST : HEADER_CONT) - FOOTER;
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
  const pages: SheetPage[] = [];
  let page: SheetPage = [[], []];
  let col = 0;
  let used = 0;

  const nextColumn = () => {
    if (col === 0) {
      col = 1;
    } else {
      pages.push(page);
      page = [[], []];
      col = 0;
    }
    used = 0;
  };

  const queue = [...sections];
  while (queue.length) {
    const section = queue.shift()!;
    const capacity = columnHeight(pages.length);
    const remaining = capacity - used;

    if (sectionHeight(section) <= remaining) {
      page[col].push(section);
      used += sectionHeight(section);
      continue;
    }

    // Doesn't fit here. Start a fresh column unless this one is already fresh —
    // in which case the section is taller than a whole column and must be split.
    if (used > 0) {
      nextColumn();
      queue.unshift(section);
      continue;
    }

    const head: SheetItem[] = [];
    let h = HEADING_H;
    for (const item of section.items) {
      if (h + itemHeight(item) > capacity) break;
      head.push(item);
      h += itemHeight(item);
    }
    // Guard against a pathological capacity leaving no room at all: always
    // place at least one item so the loop cannot spin forever.
    if (!head.length) head.push(section.items[0]);
    const tail = section.items.slice(head.length);

    page[col].push({ ...section, items: head });
    used = capacity;
    if (tail.length) queue.unshift({ ...section, items: tail, continued: true });
  }

  if (page[0].length || page[1].length) pages.push(page);
  return pages.length ? pages : [[[], []]];
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
