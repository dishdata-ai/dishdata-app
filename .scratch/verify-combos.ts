import { buildSections, paginate, isComboCategory } from "../src/lib/menu-sheet";
import fs from "node:fs";

const recipes = JSON.parse(fs.readFileSync(".scratch/kokoland-recipes.json", "utf8"));
const org = JSON.parse(fs.readFileSync(".scratch/kokoland-org.json", "utf8"))[0];
const categoryOrder = org.settings.categoryOrder;

for (const lang of ["en", "de"] as const) {
  console.log(`\n========== lang=${lang} ==========`);

  const baseline = buildSections(recipes, { withDescriptions: false, lang, categoryOrder, consolidateCombos: false });
  const consolidated = buildSections(recipes, { withDescriptions: false, lang, categoryOrder, consolidateCombos: true });

  const baselineComboCount = baseline
    .filter((s) => isComboCategory(s.category))
    .reduce((n, s) => n + s.items.length, 0);

  const combosSection = consolidated.find((s) => s.category === "Combos" || s.category === "Kombis");
  const consolidatedCount = combosSection
    ? combosSection.items.reduce((n, it: any) => n + (it.bases ? it.bases.length : 1), 0)
    : 0;

  console.log(`baseline combo-category items (spread across categories): ${baselineComboCount}`);
  console.log(`consolidated: ${combosSection?.items.length ?? 0} rows, representing ${consolidatedCount} original items`);
  console.log(`ITEM COUNT CONSERVATION: ${baselineComboCount === consolidatedCount ? "OK" : "MISMATCH!!"}`);

  if (combosSection) {
    console.log("\nConsolidated rows:");
    for (const it of combosSection.items as any[]) {
      if (it.bases) {
        console.log(`  "${it.name}": ${it.bases.map((b: any) => `${b.base} ${b.price}`).join(" / ")}`);
      } else {
        console.log(`  (standalone, unmatched) "${it.name}" — ${it.price}`);
      }
    }
  }

  // no non-combo categories should have been removed/altered
  const nonComboBaseline = baseline.filter((s) => !isComboCategory(s.category)).map((s) => s.category).sort();
  const nonComboConsolidated = consolidated.filter((s) => s.category !== "Combos" && s.category !== "Kombis").map((s) => s.category).sort();
  console.log(`\nnon-combo categories unchanged: ${JSON.stringify(nonComboBaseline) === JSON.stringify(nonComboConsolidated) ? "OK" : "MISMATCH: " + JSON.stringify(nonComboConsolidated)}`);
}
