// Lohnsteuer engine — §39b EStG monthly wage-tax procedure (laufender Arbeitslohn),
// following the structure of the official BMF Programmablaufplan (PAP):
// annualize → deductions (ANP/SAP/EFA/Vorsorgepauschale) → §32a tariff per tax class
// → Annexsteuern (Soli + Kirchensteuer) on the Kinderfreibetrag-reduced tax → /12.
//
// Pure functions, no I/O. All statutory values come from params.ts — nothing is
// hardcoded here. Rounding follows the PAP: zvE floored to full EUR, tax floored
// to full EUR, Vorsorgepauschale components ceiled to full EUR, monthly amounts
// floored to cent.

import { paramsForYear, type PayrollParams, type TaxTariff } from "./params";

export type TaxClass = 1 | 2 | 3 | 4 | 5 | 6;

export interface LohnsteuerInput {
  year: number;
  /** Monthly taxable gross wage (laufender Arbeitslohn) in EUR. */
  monthlyGross: number;
  taxClass: TaxClass;
  /** Kinderfreibetrag-Zähler from ELStAM (0, 0.5, 1, 1.5, …) — affects only Soli + KiSt. */
  kinderfreibetraege: number;
  /** Church tax: 0 (none), 0.08 (BY/BW) or 0.09 (rest). */
  churchRate: number;
  /** Employee is in statutory health insurance (GKV). Private insurance → Mindest-VSP path. */
  inGkv: boolean;
  /** Employee's Krankenkasse Zusatzbeitrag (e.g. 0.029). Falls back to the statutory average. */
  kvZusatz?: number;
  /** Employee pays into statutory pension (false for RV-exempt Minijobbers etc.). */
  inRv: boolean;
  /** Employee PV share incl. surcharges/deductions (from the SV engine), as a rate. */
  pvEmployeeRate: number;
}

export interface LohnsteuerResult {
  /** Monthly amounts in EUR (2 dp). */
  lohnsteuer: number;
  soli: number;
  kirchensteuer: number;
  /** Annual intermediate values (for the payslip audit trail). */
  annual: {
    gross: number;
    vorsorgePauschale: number;
    zvE: number;
    zvEKids: number;
    lohnsteuer: number;
    lohnsteuerKids: number;
  };
}

const floorEur = (v: number) => Math.floor(v);
const floorCent = (v: number) => Math.floor(v * 100) / 100;
const ceilEur = (v: number) => Math.ceil(v);

/** §32a EStG tariff — tax on zvE (floored to full EUR internally), floored to full EUR. */
export function grundtarif(zvE: number, t: TaxTariff): number {
  const x = floorEur(Math.max(0, zvE));
  if (x <= t.grundfreibetrag) return 0;
  if (x <= t.zone2End) {
    const y = (x - t.grundfreibetrag) / 10_000;
    return floorEur((t.z2a * y + t.z2b) * y);
  }
  if (x <= t.zone3End) {
    const z = (x - t.zone2End) / 10_000;
    return floorEur((t.z3a * z + t.z3b) * z + t.z3c);
  }
  if (x <= t.zone4End) return floorEur(t.z4Rate * x - t.z4Sub);
  return floorEur(t.z5Rate * x - t.z5Sub);
}

/** §39b(2) S.7 doubling formula with 14 % floor — PAP routine UP5_6. */
function up56(zx: number, t: TaxTariff): number {
  const doubled = 2 * (grundtarif(1.25 * zx, t) - grundtarif(0.75 * zx, t));
  return Math.max(doubled, floorEur(zx) * t.kl56MinRate);
}

/**
 * Tax by class: I/II/IV Grundtarif, III Splitting, V/VI per §39b(2) S.7.
 * V/VI follows the official PAP routine MST5_6: doubling formula with 14 % minimum,
 * growth capped at 42 % above kl56Cap42From, flat 42 %/45 % marginal bands above
 * kl56Flat42From / kl56Flat45From.
 */
export function taxForClass(zvE: number, taxClass: TaxClass, t: TaxTariff): number {
  if (zvE <= 0) return 0;
  if (taxClass === 3) return 2 * grundtarif(zvE / 2, t);
  if (taxClass === 5 || taxClass === 6) {
    const zze = floorEur(zvE);
    let st: number;
    if (zze > t.kl56Flat42From) {
      st = up56(t.kl56Flat42From, t);
      if (zze > t.kl56Flat45From) {
        st += (t.kl56Flat45From - t.kl56Flat42From) * 0.42;
        st += (zze - t.kl56Flat45From) * 0.45;
      } else {
        st += (zze - t.kl56Flat42From) * 0.42;
      }
    } else {
      st = up56(zze, t);
      if (zze > t.kl56Cap42From) {
        // Marginal growth above the first threshold is capped at 42 %.
        const capped = up56(t.kl56Cap42From, t) + (zze - t.kl56Cap42From) * 0.42;
        st = Math.min(st, capped);
      }
    }
    return floorEur(Math.max(st, 0));
  }
  return grundtarif(zvE, t);
}

/** Vorsorgepauschale §39b Abs. 2 S. 5 Nr. 3 + Abs. 4 on an explicit annual base. */
export function vorsorgePauschaleAnnual(
  annualGross: number,
  input: LohnsteuerInput,
  p: PayrollParams,
): number {
  // RV part: employee pension share on wage capped at BBG RV.
  const rvBase = Math.min(annualGross, p.bbgRvMonthly * 12);
  const rvPart = input.inRv ? ceilEur(rvBase * (p.rvRate / 2)) : 0;
  // KV/PV part: actual employee shares on wage capped at BBG KV (GKV members).
  const kvBase = Math.min(annualGross, p.bbgKvMonthly * 12);
  const zusatz = input.kvZusatz ?? p.kvZusatzDefault;
  const kvPvActual = input.inGkv
    ? ceilEur(kvBase * (p.kvRate / 2 + zusatz / 2)) + ceilEur(kvBase * input.pvEmployeeRate)
    : 0;
  // Mindestvorsorgepauschale: 12 % of wage, capped (higher cap in class III).
  const minCap = input.taxClass === 3 ? p.mindestVorsorgePauschaleIII : p.mindestVorsorgePauschale;
  const mindest = Math.min(ceilEur(annualGross * p.mindestVorsorgeRate), minCap);
  // Class VI gets no Mindestvorsorgepauschale (PAP).
  const kvPv = input.taxClass === 6 ? kvPvActual : Math.max(kvPvActual, mindest);
  return rvPart + kvPv;
}

/** Full monthly Lohnsteuer + Soli + Kirchensteuer. */
/** Annual tax parts for a given annual gross — shared by the monthly path and §39b Abs. 3. */
function annualTaxParts(annualGross: number, input: LohnsteuerInput, p: PayrollParams) {
  const t = p.tariff;
  // Deductions (§39b Abs. 2 S. 5). VSP is computed on the actual annual base.
  const anp = input.taxClass === 6 ? 0 : p.arbeitnehmerPauschbetrag;
  const sap = input.taxClass === 6 || input.taxClass === 5 ? 0 : p.sonderausgabenPauschbetrag;
  const efa = input.taxClass === 2 ? p.entlastungAlleinerziehende : 0;
  const vsp = vorsorgePauschaleAnnual(annualGross, input, p);

  const zvE = Math.max(0, annualGross - anp - sap - efa - vsp);
  const lst = taxForClass(zvE, input.taxClass, t);

  // Annexsteuern: recompute with Kinderfreibeträge deducted (§51a EStG).
  const kfb = input.kinderfreibetraege * p.kinderfreibetragProZaehler;
  const zvEKids = Math.max(0, zvE - kfb);
  const lstKids = taxForClass(zvEKids, input.taxClass, t);

  return { vsp, zvE, zvEKids, lst, lstKids };
}

/** Solidaritätszuschlag on an annual (kid-reduced) Lohnsteuer, with Freigrenze + Milderungszone. */
function annualSoliOn(annualLstKids: number, taxClass: TaxClass, p: PayrollParams): number {
  const freigrenze = taxClass === 3 ? p.soliFreigrenzeSplitting : p.soliFreigrenze;
  if (annualLstKids <= freigrenze) return 0;
  return Math.min(annualLstKids * p.soliRate, (annualLstKids - freigrenze) * p.soliMilderungRate);
}

export function calcLohnsteuer(input: LohnsteuerInput): LohnsteuerResult {
  const p = paramsForYear(input.year);
  const annualGross = input.monthlyGross * 12;
  const parts = annualTaxParts(annualGross, input, p);
  const annualSoli = annualSoliOn(parts.lstKids, input.taxClass, p);
  const annualKist = parts.lstKids * input.churchRate;

  return {
    lohnsteuer: floorCent(parts.lst / 12),
    soli: floorCent(annualSoli / 12),
    kirchensteuer: floorCent(annualKist / 12),
    annual: {
      gross: annualGross,
      vorsorgePauschale: parts.vsp,
      zvE: parts.zvE,
      zvEKids: parts.zvEKids,
      lohnsteuer: parts.lst,
      lohnsteuerKids: parts.lstKids,
    },
  };
}

/**
 * Lohnsteuer on a sonstiger Bezug (Einmalzahlung: bonus, 13. Gehalt, Urlaubsgeld…)
 * per §39b Abs. 3 EStG: tax the projected annual wage with and without the Bezug;
 * the difference is withheld on the Bezug. Soli/KiSt follow the same difference
 * method on the kid-reduced amounts (§51a; Soli-Freigrenze checked on the total).
 */
export function calcLohnsteuerSonstigerBezug(
  input: LohnsteuerInput,
  sonstigerBezug: number,
): { lohnsteuer: number; soli: number; kirchensteuer: number } {
  if (sonstigerBezug <= 0) return { lohnsteuer: 0, soli: 0, kirchensteuer: 0 };
  const p = paramsForYear(input.year);
  const annualGross = input.monthlyGross * 12;
  const without = annualTaxParts(annualGross, input, p);
  const withSb = annualTaxParts(annualGross + sonstigerBezug, input, p);

  const lstDiff = Math.max(0, withSb.lst - without.lst);
  const lstKidsDiff = Math.max(0, withSb.lstKids - without.lstKids);
  const soliDiff = Math.max(
    0,
    annualSoliOn(withSb.lstKids, input.taxClass, p) - annualSoliOn(without.lstKids, input.taxClass, p),
  );

  return {
    lohnsteuer: floorCent(lstDiff),
    soli: floorCent(soliDiff),
    kirchensteuer: floorCent(lstKidsDiff * input.churchRate),
  };
}
