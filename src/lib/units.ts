// Unit conversion for live recipe costing (inventory rebuild Phase 1).
//
// A recipe ingredient line can be written in a different unit than the
// stock item it depletes — "40g ginger" against ginger stocked in kg. This
// mirrors public.unit_factor() in migration 0051 exactly; keep both in sync.

export type MassUnit = "g" | "kg";
export type VolUnit = "ml" | "L";
export type Unit = MassUnit | VolUnit | "pc";

const MASS_TO_G: Record<MassUnit, number> = { g: 1, kg: 1000 };
const VOL_TO_ML: Record<VolUnit, number> = { ml: 1, L: 1000 };

const isMass = (u: string): u is MassUnit => u === "g" || u === "kg";
const isVol = (u: string): u is VolUnit => u === "ml" || u === "L";

/**
 * The multiplier to convert a quantity in `from` into `to`. Null "from"/"to"
 * means "same unit as the other side" (factor 1) — the safety valve that
 * lets every ingredient line written before this feature existed keep
 * depleting and costing exactly as it always has. Returns null when the
 * units can't be reconciled: crossing mass and volume, or a piece-count
 * conversion with no `gramsPerUnit` given.
 */
export function unitFactor(
  from: string | null | undefined,
  to: string | null | undefined,
  gramsPerUnit?: number | null,
): number | null {
  if (!from || !to || from === to) return 1;

  if (isMass(from) && isMass(to)) return MASS_TO_G[from] / MASS_TO_G[to];
  if (isVol(from) && isVol(to)) return VOL_TO_ML[from] / VOL_TO_ML[to];

  if (!gramsPerUnit) return null;
  if (from === "pc" && isMass(to)) return gramsPerUnit / MASS_TO_G[to];
  if (to === "pc" && isMass(from)) return MASS_TO_G[from] / gramsPerUnit;

  return null; // e.g. g <-> ml, or pc <-> ml: not reconcilable
}

export interface IngredientCostInput {
  qtyNumeric: number;
  /** Null = same unit as the stock item (today's implicit convention). */
  ingredientUnit: string | null;
  /** 1-100. Defaults to 100 (no loss) when omitted. */
  yieldPct?: number | null;
  stockUnit: string | null;
  stockUnitCost: number | null;
  gramsPerUnit?: number | null;
}

/**
 * Live cost of one recipe line linked to a stock item, or null when it
 * can't be computed (no price on the stock item, or the units don't
 * reconcile) — callers should fall back to a stored/typed cost in that case
 * rather than show a wrong number.
 */
export function computeIngredientCost(input: IngredientCostInput): number | null {
  const { qtyNumeric, ingredientUnit, yieldPct, stockUnit, stockUnitCost, gramsPerUnit } = input;
  if (stockUnitCost == null) return null;
  const factor = unitFactor(ingredientUnit, stockUnit, gramsPerUnit);
  if (factor == null) return null;
  const yieldFrac = (yieldPct ?? 100) / 100;
  if (yieldFrac <= 0) return null;
  return (qtyNumeric * factor * stockUnitCost) / yieldFrac;
}
