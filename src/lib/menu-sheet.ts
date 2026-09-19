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
  /**
   * null = no dietary symbol shown. For a consolidated combo row, the
   * curry's own tag — bases share one curry, so it's one tag for the whole
   * row: the first non-null tag found among its base recipes wins, rather
   * than requiring every base to agree, since a manager tagging just one of
   * them shouldn't silently hide it from the printed row.
   */
  diet: "veg" | "vegan" | null;
  /**
   * Present only for a consolidated combo row (see `consolidateCombos()`):
   * one entry per base this curry is offered with, in the source
   * categories' own encounter order. `price` above is always null when this
   * is set — there's no single number to show next to the name, each base
   * has its own. Absent for every ordinary item, which is every item
   * anywhere else in the codebase — paginate(), sectionHeight(),
   * columnHeight() and every non-combo render path stay entirely unaware
   * this field exists.
   */
  bases?: {
    base: string;
    price: number | null;
    /** Pre-formatted "N pcs"/"N Stk." when the base has a known fixed serving count; kept separate from `base` so grouping/`comboBasesNote` lookups stay keyed on the plain base name. */
    serving?: string;
  }[];
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
  /** One-time explanatory line printed once under the heading (e.g. what the combo bases are). */
  note?: string;
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

// A consolidated combo row (see consolidateComboItems()) is the curry name
// plus one short, fixed-shape "base — price" line per base ("Porotta
// 14,90 €") — not wrapped prose, so this is a flat per-line height like
// NAME_LINE_H, not a char-count wrap model like DESC_LINE_H/
// DESC_CHARS_PER_LINE. Measured directly against the real rendered DOM (a
// 4-base row): 0.8mm gap before the base list + N × 3.97mm per base line +
// (N-1) × 0.4mm between lines + 2.0mm trailing margin — algebraically
// exactly `2.4 + 4.37×N`. Rounded up a shade for the same reason every
// other constant here is: ending a row early is invisible, overflowing one
// is not.
const COMBO_BASE_ROW_H = 4.4; // mm, one base+price line
const COMBO_BASE_ROW_MARGIN = 2.5; // mm, row's own top/bottom breathing room

// Placeholder wrap model for a section's one-time note (comboBasesNote) —
// same column width as an item description, so borrowing its calibrated
// chars-per-line is a reasonable starting point pending real-DOM measurement.
const NOTE_CHARS_PER_LINE = 57;
const NOTE_LINE_H = 3.9;
const NOTE_BASE = 3.9; // mm, note's own top margin under the heading
const NOTE_SAFETY = 2; // mm, covers a note landing right at a wrap boundary

const PAGE_H = 297;
const PAD_Y = 22; // 12mm top + 10mm bottom
// Measured against the real rendered header (both org logo present and the
// text-fallback path): the logo is capped at a fixed h-[30mm], and the
// date+title+underline block on the right — the side that actually decides
// this row's height once a logo caps the left side — measures ~28mm
// regardless of org name or date, since both are fixed-shape content (a
// two-line "Today's Menu"/"Tageskarte" title, not variable text). The
// previous 50mm was never measured against real output; the ~20mm gap
// between it and reality was quietly costing every page-1 column that much
// less content than it could actually hold.
const HEADER_FIRST = 33;
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
  combos: string;
  or: string;
}> = {
  en: {
    title: "Today's Menu",
    stocks: "Available today while stocks last",
    footnote: "Please ask our team about allergens and dietary requirements.",
    continued: "(cont.)",
    combos: "Curry Combo",
    or: "or",
  },
  de: {
    title: "Tageskarte",
    stocks: "Heute verfügbar, solange der Vorrat reicht",
    footnote: "Bitte sprechen Sie unser Team auf Allergene und Ernährungswünsche an.",
    continued: "(Fortsetzung)",
    combos: "Curry-Kombi",
    or: "oder",
  },
};

/**
 * Short, one-time explanations for the less familiar breads/bases a curry
 * combo can come with — printed once under the "Curry Combo" heading (see
 * `comboBasesNote`) rather than repeated on every row. Keyed lowercase,
 * matched against whatever the recipe's own name actually starts with, so
 * this also silently covers the German base word ("Reis" vs "Rice") without
 * needing a separate translation lookup keyed by category. An unrecognised
 * future base (a genuinely new bread the menu hasn't seen yet) just prints
 * unexplained — no broken text, it simply isn't in this table yet.
 */
/**
 * How many pieces of a bread a combo actually comes with — restaurant-set
 * fact, not derived from anything else in the data (a curry's price doesn't
 * say whether it ships with 2 porottas or 4 pathiris). Keyed lowercase like
 * `BASE_DESCRIPTIONS`; a base with no entry here (rice, or a future base
 * nobody's specified a count for yet) simply shows no piece count.
 */
const BASE_SERVING_COUNT: Record<string, number> = {
  porotta: 2,
  pathiri: 4,
  idiappam: 3,
};

const SERVING_UNIT: Record<SheetLang, string> = { en: "pcs", de: "Stk." };

const BASE_DESCRIPTIONS: Record<SheetLang, Record<string, string>> = {
  en: {
    porotta: "flaky, layered flatbread",
    rice: "steamed rice",
    pathiri: "thin rice crêpe",
    idiappam: "steamed rice noodles",
    puttu: "steamed rice-flour cylinder",
  },
  de: {
    porotta: "knuspriges, mehrschichtiges Fladenbrot",
    reis: "gedämpfter Reis",
    pathiri: "hauchfeine Reis-Crêpe",
    idiappam: "gedämpfte Reisnudeln",
    puttu: "gedämpftes Reismehl-Röllchen",
  },
};

/**
 * Builds the one-line "Porotta (flaky, layered flatbread) · Rice (steamed
 * rice)" note for a consolidated combo section, from whichever bases are
 * actually present in it — so it only ever lists bases the menu currently
 * offers, and grows or shrinks on its own as bases are added or removed.
 * Undefined (no note printed) when nothing in the section has a known
 * description yet.
 */
function comboBasesNote(items: SheetItem[], lang: SheetLang): string | undefined {
  const seen = new Map<string, string>(); // lowercase key -> original-case label
  for (const item of items) {
    for (const { base } of item.bases ?? []) {
      const key = base.toLowerCase();
      if (!seen.has(key)) seen.set(key, base);
    }
  }
  const dict = BASE_DESCRIPTIONS[lang];
  const parts = [...seen.entries()]
    .filter(([key]) => dict[key])
    .map(([key, label]) => `${label} (${dict[key]})`);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * True when every base offered for a combo item costs the same — the common
 * case (see `BASE_SERVING_COUNT`'s callers), where printing the identical
 * price on every base's own line repeats a number with nothing new to say
 * and reads ambiguously, like ordering both instead of choosing one. Only
 * ever consulted for a `bases` array (length > 1 by construction — see
 * `consolidateComboItems`), so no separate length check is needed here.
 * `null` (price-on-request) only "matches" another `null` — "ask us" and a
 * real price are genuinely different answers, not a coincidence to collapse.
 */
export function basesShareOnePrice(bases: NonNullable<SheetItem["bases"]>): boolean {
  return bases.every((b) => b.price === bases[0].price);
}

/** "Porotta (2 pcs) or Rice" / "... oder ..." — only meaningful when basesShareOnePrice(). */
export function joinBaseNames(bases: NonNullable<SheetItem["bases"]>, lang: SheetLang): string {
  const labels = bases.map((b) => (b.serving ? `${b.base} (${b.serving})` : b.base));
  const or = SHEET_STRINGS[lang].or;
  if (labels.length < 2) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} ${or} ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, ${or} ${labels[labels.length - 1]}`;
}

export function isAvailableToday(r: Pick<Recipe, "is_active" | "sold_out_until">): boolean {
  return r.is_active && !isSoldOut(r);
}

const COMBO_CATEGORY = /combo/i;

/**
 * Whether a category should fold into the consolidated "Combos" section
 * when that print option is on — detected purely from the category's own
 * name (matches "Porotta Combos", "Rice & Curry Combo", and any future
 * "___ Combos" category with zero configuration), the same naming-
 * convention-as-behavior approach `LAST_BY_DEFAULT` already uses in
 * category-order.ts. Exposed as its own predicate so an explicit
 * include/exclude override can replace the regex later without touching
 * any call site, if this convention ever stops being reliable.
 */
export function isComboCategory(category: string): boolean {
  return COMBO_CATEGORY.test(category);
}

// Matches both languages' connector word — a German-named item reads
// "Porotta mit Kerala Beef Curry", not "... with ...", and the sheet always
// prints in one specific language at a time, so this has to catch whichever
// one is actually on the page rather than only the English convention.
const COMBO_NAME_PATTERN = /^(\S+)\s+(?:with|mit)\s+(.+)$/i;

/**
 * Collapse "{base} with {curry}" items from every combo category into one
 * row per curry, each listing the bases it's offered with and their own
 * price — "Porotta with Kerala Beef Curry" (14,90 €) and "Rice with Kerala
 * Beef Curry" (14,90 €) become a single "Kerala Beef Curry" row listing
 * both. Bases stay in the order their recipes were originally entered
 * (Porotta before Rice, in the real data), not alphabetised.
 *
 * Grouped on the curry text alone — case-insensitive, trimmed, nothing
 * fuzzier. A name that doesn't match "{base} with {curry}" at all, or a
 * curry whose text doesn't exactly match another combo item's (a stray
 * double space, say), prints as an ordinary standalone item instead of
 * being merged — never silently dropped, and deliberately not "fixed up"
 * here: staying visibly un-consolidated on the printed preview is a more
 * honest nudge to go fix the source recipe name than papering over it.
 */
function consolidateComboItems(comboItems: SheetItem[], lang: SheetLang): SheetItem[] {
  const groups = new Map<string, { curry: string; bases: NonNullable<SheetItem["bases"]>; diet: SheetItem["diet"] }>();
  const standalone: SheetItem[] = [];

  for (const item of comboItems) {
    const match = COMBO_NAME_PATTERN.exec(item.name);
    if (!match) {
      standalone.push(item);
      continue;
    }
    const [, base, curry] = match;
    const key = curry.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, { curry: curry.trim(), bases: [], diet: item.diet });
    else if (!groups.get(key)!.diet && item.diet) groups.get(key)!.diet = item.diet;
    const count = BASE_SERVING_COUNT[base.toLowerCase()];
    const serving = count ? `${count} ${SERVING_UNIT[lang]}` : undefined;
    groups.get(key)!.bases.push({ base, price: item.price, serving });
  }

  const consolidated: SheetItem[] = [...groups.values()].map(({ curry, bases, diet }) => ({
    name: curry,
    price: null,
    description: null,
    diet,
    bases,
  }));

  return [...consolidated, ...standalone];
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
    consolidateCombos = false,
  }: {
    withDescriptions?: boolean;
    lang?: SheetLang;
    categoryOrder?: string[] | null;
    /** Print-only, opt-in: fold every combo category (see `isComboCategory`) into one consolidated "Combos" section instead of printing each separately. */
    consolidateCombos?: boolean;
  } = {},
): SheetSection[] {
  const order: string[] = []; // English category, for ordering
  const displayOf = new Map<string, string>(); // English category -> display label
  const byCategory = new Map<string, SheetItem[]>(); // keyed by English category

  // German falls back to English field by field, so a half-translated menu
  // prints the translations that exist rather than gaps where they don't.
  const de = lang === "de";
  const pick = (german: string | null, english: string) => (de && german ? german : english);

  // Every combo-category item is diverted here instead of `byCategory`, then
  // consolidated once after the loop — see consolidateComboItems(). Not a
  // real category name (never collides with a recipe's own category), so
  // it's safe to use as `order`'s and `displayOf`'s key too.
  const COMBOS_KEY = "__combos__";
  const comboItems: SheetItem[] = [];

  // Oldest-first, as a stable base order before categoryOrder is applied.
  for (const r of [...recipes].reverse()) {
    if (!isAvailableToday(r)) continue;
    const englishCategory = (r.category || "Weitere").trim();
    const description = withDescriptions
      ? pick(r.description_de, r.description || "").trim() || null
      : null;
    const item: SheetItem = {
      name: pick(r.name_de, r.name).trim(),
      // A zero price means "ask us" rather than "free" — printing "0.00 €"
      // on a menu is worse than printing nothing at all.
      price: r.price > 0 ? r.price : null,
      description,
      diet: r.diet ?? null,
    };

    if (consolidateCombos && isComboCategory(englishCategory)) {
      if (!byCategory.has(COMBOS_KEY)) {
        byCategory.set(COMBOS_KEY, []);
        // Fixed sheet furniture, not derived from any one source category's
        // name — "Rice & Curry Combo" alone would misname the heading once
        // Porotta/Pathiri/Idiappam are folded in too.
        displayOf.set(COMBOS_KEY, SHEET_STRINGS[lang].combos);
        order.push(COMBOS_KEY);
      }
      comboItems.push(item);
      continue;
    }

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
    byCategory.get(englishCategory)!.push(item);
  }

  if (comboItems.length) {
    byCategory.set(COMBOS_KEY, consolidateComboItems(comboItems, lang));
  }

  const ordered = orderCategories(order, categoryOrder);
  // The generated section has no entry in the saved category order, so it
  // can land after even explicitly ordered desserts and drinks. Move it up
  // before those closing sections while preserving every other category's order.
  const comboIndex = ordered.indexOf(COMBOS_KEY);
  const closingIndex = ordered.findIndex((category) =>
    /dessert|sweet|beverage|drink|getr(ä|ae)nk|nachspeis|süß|suess/i.test(category),
  );
  if (comboIndex >= 0 && closingIndex >= 0 && comboIndex > closingIndex) {
    ordered.splice(comboIndex, 1);
    ordered.splice(closingIndex, 0, COMBOS_KEY);
  }

  return ordered.map((englishCategory) => {
    const display = displayOf.get(englishCategory)!;
    const items = byCategory.get(englishCategory)!;
    const note = englishCategory === COMBOS_KEY ? comboBasesNote(items, lang) : undefined;
    return { category: display, items, note };
  });
}

function itemHeight(item: SheetItem): number {
  const nameLines = Math.max(1, Math.ceil(item.name.length / NAME_CHARS_PER_LINE));
  let h = nameLines * NAME_LINE_H;
  if (item.bases) {
    // Scales with base count on purpose — a flat estimate would be wrong
    // precisely once bases go from 2 to 4, which is the reason this exists.
    // Equal-priced bases collapse onto one printed line (see
    // basesShareOnePrice/joinBaseNames in MenuSheet.tsx), so that case costs
    // the same one row height regardless of how many bases it lists.
    const rows = basesShareOnePrice(item.bases) ? 1 : item.bases.length;
    h += COMBO_BASE_ROW_H * rows + COMBO_BASE_ROW_MARGIN;
  } else if (item.description) {
    const descLines = Math.max(1, Math.ceil(item.description.length / DESC_CHARS_PER_LINE));
    h += DESC_BASE + descLines * DESC_LINE_H + DESC_SAFETY + ITEM_MARGIN_WITH_DESC;
  } else {
    h += ITEM_MARGIN_NO_DESC;
  }
  return h;
}

function noteHeight(note: string): number {
  const lines = Math.max(1, Math.ceil(note.length / NOTE_CHARS_PER_LINE));
  return NOTE_BASE + lines * NOTE_LINE_H + NOTE_SAFETY;
}

const sectionHeight = (s: SheetSection) =>
  HEADING_H +
  (s.note ? noteHeight(s.note) : 0) +
  s.items.reduce((h, i) => h + itemHeight(i), 0) +
  SECTION_GAP;

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
    const noteH = section.note ? noteHeight(section.note) : 0;
    const worthSplittingHere = remaining >= HEADING_H + noteH + smallestItemHeight + SECTION_GAP;
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
    let h = HEADING_H + noteH;
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
    // note already printed once with `head` above — a continuation repeats
    // the heading (see headingVisible) but not this, or "once" becomes twice.
    if (tail.length) queue.unshift({ ...section, items: tail, continued: true, note: undefined });
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
