import { buildSections, paginate } from "../src/lib/menu-sheet";
import fs from "node:fs";

const recipes = JSON.parse(fs.readFileSync(".scratch/kokoland-recipes.json", "utf8"));
const org = JSON.parse(fs.readFileSync(".scratch/kokoland-org.json", "utf8"))[0];
const categoryOrder = org.settings.categoryOrder;

const HEADING_H = 11, SECTION_GAP = 7;
const NAME_CHARS_PER_LINE = 35, NAME_LINE_H = 4.65, ITEM_MARGIN_NO_DESC = 1.7;
const COMBO_BASE_ROW_H = 4.2, COMBO_BASE_ROW_MARGIN = 2;
const PAGE_H = 297, PAD_Y = 22, HEADER_FIRST = 33, HEADER_CONT = 16;
const FOOTER_LAST = 24, FOOTER_SLIM = 10, SAFETY_MARGIN = 6;

function itemHeight(item: any): number {
  const nameLines = Math.max(1, Math.ceil(item.name.length / NAME_CHARS_PER_LINE));
  let h = nameLines * NAME_LINE_H;
  if (item.bases) h += COMBO_BASE_ROW_H * item.bases.length + COMBO_BASE_ROW_MARGIN;
  else h += ITEM_MARGIN_NO_DESC;
  return h;
}
const sectionHeight = (s: any) => HEADING_H + s.items.reduce((h: number, i: any) => h + itemHeight(i), 0) + SECTION_GAP;

let anyFail = false;
for (const lang of ["en", "de"] as const) {
  for (const consolidateCombos of [false, true]) {
    const sections = buildSections(recipes, { withDescriptions: false, lang, categoryOrder, consolidateCombos });
    const pages = paginate(sections);
    let overflowCount = 0, totalItems = 0;
    const fills: number[] = [];
    pages.forEach((page, pi) => {
      const footer = pi >= pages.length - 1 ? FOOTER_LAST : FOOTER_SLIM;
      const capacity = PAGE_H - PAD_Y - (pi === 0 ? HEADER_FIRST : HEADER_CONT) - footer - SAFETY_MARGIN;
      page.forEach((col: any) => {
        const used = col.reduce((h: number, s: any) => h + sectionHeight(s), 0);
        // count raw dishes represented (bases count as their true underlying items)
        totalItems += col.reduce((n: number, s: any) => n + s.items.reduce((m: number, it: any) => m + (it.bases ? it.bases.length : 1), 0), 0);
        if (used > capacity) { overflowCount++; anyFail = true; }
        if (col.length) fills.push(100 * used / capacity);
      });
    });
    console.log(`lang=${lang} consolidateCombos=${consolidateCombos}: ${pages.length} pages, dishes=${totalItems}, overflow=${overflowCount}, fills=[${fills.map(f=>f.toFixed(0)).join(",")}]%`);
  }
}
console.log(anyFail ? "\nFAIL" : "\nALL OK — zero overflow");
