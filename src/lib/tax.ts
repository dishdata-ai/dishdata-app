/**
 * Per-rate VAT breakdown — food and drinks can carry different rates on the
 * same order (see migration 0032), so tax is extracted per rate group rather
 * than once on the whole order.
 *
 * This mirrors checkout_order / place_public_order in
 * supabase/migrations/0032_per_item_tax_rate.sql exactly (same proportional
 * discount allocation, same VAT-included extraction). It's used here for:
 *   - the demo-mode (no Supabase) checkout/storefront paths, which have no
 *     database function to call and must replicate the RPC's math in JS
 *   - reconstructing the breakdown for display on a receipt, from the
 *     tax_rate already snapshotted onto each stored order line
 * Keep this and the SQL in sync if either changes.
 */

export interface TaxGroup {
  rate: number;
  /** This group's share of the order, after its proportional share of any discount — what was actually charged for these lines. */
  gross: number;
  /** VAT contained within `gross`. */
  tax: number;
  /** `gross - tax`. */
  net: number;
}

export interface TaxLine {
  price: number;
  qty: number;
  /** Falls back to `orgRate` when absent (unset on the recipe, or a pre-0032 order with no snapshotted rate). */
  tax_rate?: number | null;
}

/**
 * Group `lines` by VAT rate, allocate `discount` proportionally across the
 * groups by their share of gross, and extract VAT per group.
 * Sorted ascending by rate (lowest first) for a stable, predictable receipt.
 */
export function computeTaxGroups(lines: TaxLine[], orgRate: number, discount: number): TaxGroup[] {
  const rawGrossByRate = new Map<number, number>();
  let rawGrossTotal = 0;
  for (const l of lines) {
    const rate = l.tax_rate ?? orgRate;
    const gross = l.price * l.qty;
    rawGrossTotal += gross;
    rawGrossByRate.set(rate, (rawGrossByRate.get(rate) ?? 0) + gross);
  }

  return [...rawGrossByRate.entries()]
    .map(([rate, rawGross]) => {
      const allocatedDiscount = rawGrossTotal > 0 ? (discount * rawGross) / rawGrossTotal : 0;
      const gross = Math.max(rawGross - allocatedDiscount, 0);
      const tax = +(gross * (rate / (100 + rate))).toFixed(2);
      const net = +(gross - tax).toFixed(2);
      return { rate, gross: +gross.toFixed(2), tax, net };
    })
    .sort((a, b) => a.rate - b.rate);
}

export function sumTax(groups: TaxGroup[]): number {
  return +groups.reduce((s, g) => s + g.tax, 0).toFixed(2);
}
