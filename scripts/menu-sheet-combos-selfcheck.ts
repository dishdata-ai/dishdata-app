// Menu sheet "combined combos" self-check: consolidation, both-language
// connector matching, item-count conservation, and overflow safety.
// Run: npx tsx scripts/menu-sheet-combos-selfcheck.ts
//
// This file (menu-sheet.ts) has had several real pagination bugs found and
// fixed against live Kokoland data — the fixtures below are shaped after
// exactly the case that broke first: three combo categories (Porotta, Rice,
// Pathiri) with slightly inconsistent naming (a German "mit" instead of
// "with", a curry with no connector word at all), which real recipe data
// already looks like once a restaurant is mid-migration onto more bases.

import { buildSections, paginate, isComboCategory, type SheetItem } from "../src/lib/menu-sheet";
import type { Recipe } from "../src/lib/api/database.types";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) { failures++; console.error(`  FAIL  ${name} ${detail}`); }
  else console.log(`  ok    ${name}`);
};

let n = 0;
function recipe(fields: Partial<Recipe> & { name: string; category: string; price: number }): Recipe {
  n++;
  return {
    id: `r${n}`, org_id: "org1", prep_minutes: 10, emoji: "🍛", image_url: null,
    is_active: true, created_at: new Date().toISOString(), created_by: null, sold_out_until: null,
    description: null, name_de: null, description_de: null, category_de: null, tax_rate: null,
    ...fields,
  } as Recipe;
}

console.log("== isComboCategory ==");
check("detects 'Porotta Combos'", isComboCategory("Porotta Combos"));
check("detects 'Rice & Curry Combo' (singular)", isComboCategory("Rice & Curry Combo"));
check("detects future 'Idiappam Combos'", isComboCategory("Idiappam Combos"));
check("does not match unrelated category", !isComboCategory("Beverages"));

console.log("\n== Consolidation: same curry, three bases, minor naming drift ==");
const recipes: Recipe[] = [
  recipe({ name: "Porotta with Kerala Beef Curry", category: "Porotta Combos", price: 14.9 }),
  recipe({ name: "Rice with Kerala Beef Curry", category: "Rice Combos", price: 14.9 }),
  recipe({ name: "Pathiri with Kerala Beef Curry", category: "Pathiri Combos", price: 15.9 }),
  // German-named item — must match via "mit", not just "with".
  recipe({ name: "Porotta mit Gobi Manchurian", category: "Porotta Combos", price: 11.5, name_de: "Porotta mit Gobi Manchurian" }),
  recipe({ name: "Rice mit Gobi Manchurian", category: "Rice Combos", price: 11.5 }),
  // No connector word at all — must fall back to standalone, not crash or vanish.
  recipe({ name: "Porotta Special Veg", category: "Porotta Combos", price: 9.5 }),
  // Non-combo category — must be completely unaffected either way.
  recipe({ name: "Chai", category: "Beverages", price: 2.5 }),
];

const baseline = buildSections(recipes, { consolidateCombos: false });
const consolidated = buildSections(recipes, { consolidateCombos: true });

const totalActive = recipes.filter((r) => r.is_active).length;
const baselineCount = baseline.reduce((sum, s) => sum + s.items.length, 0);
const consolidatedDishCount = consolidated.reduce(
  (sum, s) => sum + s.items.reduce((m, it) => m + ((it as SheetItem).bases?.length ?? 1), 0),
  0,
);
check("baseline: one SheetItem per recipe", baselineCount === totalActive, `${baselineCount} vs ${totalActive}`);
check(
  "consolidated: dish count conserved (bases + standalone == every recipe)",
  consolidatedDishCount === totalActive,
  `${consolidatedDishCount} vs ${totalActive}`,
);

check("toggle off: no 'Combos' section at all", !baseline.some((s) => s.category === "Combos"));
const combos = consolidated.find((s) => s.category === "Combos");
check("toggle on: 'Combos' section exists", !!combos);
check("non-combo category (Beverages) untouched", consolidated.some((s) => s.category === "Beverages" && s.items.length === 1));

const beefCurry = combos?.items.find((it) => it.name === "Kerala Beef Curry") as SheetItem | undefined;
check("'Kerala Beef Curry' consolidated across all 3 bases", beefCurry?.bases?.length === 3, JSON.stringify(beefCurry?.bases));
check("'Kerala Beef Curry' bases carry their own price (Pathiri costs more)", beefCurry?.bases?.find((b) => b.base === "Pathiri")?.price === 15.9);

const gobi = combos?.items.find((it) => it.name === "Gobi Manchurian") as SheetItem | undefined;
check("German 'mit' connector matches the English 'with' one", gobi?.bases?.length === 2, JSON.stringify(gobi?.bases));

const standalone = combos?.items.find((it) => it.name === "Porotta Special Veg");
check("item with no connector word falls back standalone, not dropped", !!standalone && !(standalone as SheetItem).bases);

console.log("\n== Pagination stays overflow-safe with combo rows ==");
// Same curry offered with every base at once (4), stressing the height
// estimate for the base-count-scaling branch specifically.
const manyBases: Recipe[] = ["Porotta", "Rice", "Pathiri", "Idiappam"].map((base) =>
  recipe({ name: `${base} with Stress Test Curry`, category: `${base} Combos`, price: 12.5 }),
);
for (const lang of ["en", "de"] as const) {
  const sections = buildSections(manyBases, { consolidateCombos: true, lang });
  const pages = paginate(sections);
  const row = sections[0]?.items[0] as SheetItem | undefined;
  check(`lang=${lang}: 4-base row built correctly`, row?.bases?.length === 4);
  check(`lang=${lang}: paginate() doesn't throw or drop the page`, pages.length >= 1);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL OK");
process.exit(failures ? 1 : 0);
