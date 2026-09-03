import { isSoldOut } from "@/lib/calc";
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
 */
const ITEM_H = 5.4;
const ITEM_DESC_EXTRA = 4.4;
const HEADING_H = 12.5;
const SECTION_GAP = 7;

const PAGE_H = 297;
const PAD_Y = 22; // 12mm top + 10mm bottom
const HEADER_FIRST = 50; // logo, date and the "Today's Menu" title block
const HEADER_CONT = 16; // slim running header on later pages
const FOOTER = 24; // reserved on every page, so the last one always has room

/** Drinks conventionally close a menu, whatever order the categories were created in. */
const LAST_CATEGORIES = ["beverages", "drinks", "getränke", "getraenke"];

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
 * Category order follows the order the categories were created in (recipes
 * arrive newest-first, so this reverses to oldest-first) rather than
 * alphabetically — that way the sheet keeps the shape the kitchen built the
 * menu in, and reordering is a matter of creating categories in the order you
 * want them read.
 */
export function buildSections(
  recipes: Recipe[],
  { withDescriptions = false, lang = "en" }: { withDescriptions?: boolean; lang?: SheetLang } = {},
): SheetSection[] {
  const order: string[] = [];
  const byCategory = new Map<string, SheetItem[]>();

  // German falls back to English field by field, so a half-translated menu
  // prints the translations that exist rather than gaps where they don't.
  const de = lang === "de";
  const pick = (german: string | null, english: string) => (de && german ? german : english);

  // Oldest-first so category order reads the way the menu was built up.
  for (const r of [...recipes].reverse()) {
    if (!isAvailableToday(r)) continue;
    const category = pick(r.category_de, r.category || "Weitere").trim();
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
      order.push(category);
    }
    const description = withDescriptions
      ? pick(r.description_de, r.description || "").trim() || null
      : null;
    byCategory.get(category)!.push({
      name: pick(r.name_de, r.name).trim(),
      // A zero price means "ask us" rather than "free" — printing "0.00 €"
      // on a menu is worse than printing nothing at all.
      price: r.price > 0 ? r.price : null,
      description,
    });
  }

  const rank = (c: string) => (LAST_CATEGORIES.includes(c.toLowerCase()) ? 1 : 0);
  return order
    .map((category) => ({ category, items: byCategory.get(category)! }))
    .sort((a, b) => rank(a.category) - rank(b.category));
}

const itemHeight = (item: SheetItem) => ITEM_H + (item.description ? ITEM_DESC_EXTRA : 0);

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
