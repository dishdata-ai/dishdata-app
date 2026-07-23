// Sozialversicherung engine — KV/RV/AV/PV employee+employer shares, Minijob
// (pauschal contributions to the Minijob-Zentrale), Midijob Übergangsbereich
// (§20 Abs. 2a SGB IV reduced employee base via Faktor F), and employer Umlagen
// (U1 Lohnfortzahlung, U2 Mutterschaft, Insolvenzgeldumlage).
//
// Pure functions; statutory values from params.ts. Amounts rounded to cent
// (standard commercial rounding, as used by SV-Rechnung).

import { paramsForYear, type PayrollParams } from "./params";

export type EmploymentKind = "standard" | "minijob" | "midijob";

export interface SvInput {
  year: number;
  monthlyGross: number;
  /** In statutory health insurance (GKV). Private → no KV/PV via payroll here (PKV Phase 2). */
  inGkv: boolean;
  /** Employee's Krankenkasse Zusatzbeitrag (e.g. 0.029). */
  kvZusatz?: number;
  /** Childless and ≥ 23 → PV surcharge. */
  pvChildless: boolean;
  /** Number of children under 25 (for the PV deduction, children 2–5). */
  childrenUnder25: number;
  /** Workplace in Saxony (special PV split). */
  inSaxony: boolean;
  /** Minijobber opted out of pension insurance (Befreiungsantrag). */
  minijobRvExempt: boolean;
  /** Krankenkasse-specific Umlage rates; fall back to params defaults. */
  u1Rate?: number;
  u2Rate?: number;
}

export interface SvBranch {
  employee: number;
  employer: number;
}

export interface SvResult {
  kind: EmploymentKind;
  kv: SvBranch;
  rv: SvBranch;
  av: SvBranch;
  pv: SvBranch;
  /** Employer-only: U1 + U2 + Insolvenzgeldumlage. */
  umlagen: { u1: number; u2: number; insolvenz: number };
  /** Minijob only: 2 % Pauschsteuer paid by the employer to the Minijob-Zentrale. */
  pauschsteuer: number;
  totalEmployee: number;
  totalEmployer: number;
  /** Effective employee PV rate (needed by the Lohnsteuer Vorsorgepauschale). */
  pvEmployeeRate: number;
  /** Audit trail. */
  detail: Record<string, number>;
}

const cent = (v: number) => Math.round(v * 100) / 100;

export function classifyEmployment(monthlyGross: number, p: PayrollParams): EmploymentKind {
  if (monthlyGross <= p.minijobLimit) return "minijob";
  if (monthlyGross <= p.midijobLimit) return "midijob";
  return "standard";
}

/** Employee PV rate incl. childless surcharge, child deduction and Saxony split. */
export function pvEmployeeRateFor(input: Pick<SvInput, "pvChildless" | "childrenUnder25" | "inSaxony">, p: PayrollParams): number {
  let rate = p.pvRate / 2 + (input.inSaxony ? p.pvSaxonyEmployeeExtra : 0);
  if (input.pvChildless) {
    rate += p.pvChildlessSurcharge;
  } else {
    // Children 2–5 under 25 reduce the employee share by 0.25 pp each.
    const deductible = Math.min(Math.max(input.childrenUnder25 - 1, 0), 4);
    rate -= deductible * p.pvChildDeductionPerKid;
  }
  return rate;
}

export interface SvEinmalzahlungInput {
  year: number;
  sonstigerBezug: number;
  /** Month of payment (1–12) — determines the anteilige Jahres-BBG. */
  month: number;
  /** SV-liable wage Jan..payment month (incl. current laufend, excl. this Bezug). */
  ytdKvBase: number;
  ytdRvBase: number;
  inGkv: boolean;
  kvZusatz?: number;
  pvChildless: boolean;
  childrenUnder25: number;
  inSaxony: boolean;
}

/**
 * SV on an Einmalzahlung (§23a SGB IV): full rates (the Midijob reduction does NOT
 * apply to einmalig gezahltes Entgelt), base capped by the remaining headroom against
 * the anteilige Jahres-BBG (monthly BBG × months elapsed − YTD SV-liable wage).
 * U1/U2 are not owed on one-off payments; the Insolvenzgeldumlage is.
 * Märzklausel (attribution to the previous year) is NOT implemented — see README.
 */
export function calcSvEinmalzahlung(input: SvEinmalzahlungInput): {
  kv: SvBranch; rv: SvBranch; av: SvBranch; pv: SvBranch;
  insolvenz: number; totalEmployee: number; totalEmployer: number;
  baseKv: number; baseRv: number;
} {
  const p = paramsForYear(input.year);
  const zusatz = input.kvZusatz ?? p.kvZusatzDefault;
  const pvEeRate = pvEmployeeRateFor(input, p);
  const pvErRate = input.inSaxony ? p.pvRate / 2 - p.pvSaxonyEmployeeExtra : p.pvRate / 2;

  const headroomKv = Math.max(0, p.bbgKvMonthly * input.month - input.ytdKvBase);
  const headroomRv = Math.max(0, p.bbgRvMonthly * input.month - input.ytdRvBase);
  const baseKv = input.inGkv ? Math.min(input.sonstigerBezug, headroomKv) : 0;
  const baseRv = Math.min(input.sonstigerBezug, headroomRv);

  const half = (base: number, totalRate: number, eeRate: number): SvBranch => ({
    employee: cent(base * eeRate),
    employer: cent(base * (totalRate - eeRate)),
  });
  const kv = half(baseKv, p.kvRate + zusatz, (p.kvRate + zusatz) / 2);
  const pv = half(baseKv, pvEeRate + pvErRate, pvEeRate);
  const rv = half(baseRv, p.rvRate, p.rvRate / 2);
  const av = half(baseRv, p.avRate, p.avRate / 2);
  const insolvenz = cent(baseRv * p.insolvenzgeldUmlage);

  return {
    kv, rv, av, pv, insolvenz,
    totalEmployee: cent(kv.employee + rv.employee + av.employee + pv.employee),
    totalEmployer: cent(kv.employer + rv.employer + av.employer + pv.employer + insolvenz),
    baseKv, baseRv,
  };
}

export function calcSozialversicherung(input: SvInput): SvResult {
  const p = paramsForYear(input.year);
  const kind = classifyEmployment(input.monthlyGross, p);
  const zusatz = input.kvZusatz ?? p.kvZusatzDefault;
  const u1Rate = input.u1Rate ?? p.u1Default;
  const u2Rate = input.u2Rate ?? p.u2Default;
  const pvEeRate = pvEmployeeRateFor(input, p);
  const pvErRate = input.inSaxony ? p.pvRate / 2 - p.pvSaxonyEmployeeExtra : p.pvRate / 2;

  const zero: SvBranch = { employee: 0, employer: 0 };
  const detail: Record<string, number> = {};

  if (kind === "minijob") {
    const g = input.monthlyGross;
    // Employer pauschal contributions to the Minijob-Zentrale.
    const kvEr = input.inGkv ? cent(g * p.minijobPauschalKv) : 0;
    const rvEr = cent(g * p.minijobPauschalRv);
    // Employee RV top-up to the full rate unless exempt (base at least 175 € Mindestbeitragsbasis).
    const rvEeBase = input.minijobRvExempt ? 0 : Math.max(g, 175);
    const rvEe = cent(rvEeBase * (p.rvRate - p.minijobPauschalRv));
    const pauschsteuer = cent(g * p.minijobPauschalTax);
    const u1 = cent(g * u1Rate);
    const u2 = cent(g * u2Rate);
    const inso = cent(g * p.insolvenzgeldUmlage);
    detail.rvTopUpBase = rvEeBase;
    return {
      kind,
      kv: { employee: 0, employer: kvEr },
      rv: { employee: rvEe, employer: rvEr },
      av: zero,
      pv: zero,
      umlagen: { u1, u2, insolvenz: inso },
      pauschsteuer,
      totalEmployee: rvEe,
      totalEmployer: cent(kvEr + rvEr + pauschsteuer + u1 + u2 + inso),
      pvEmployeeRate: 0,
      detail,
    };
  }

  // Contribution bases. Midijob: reduced total base (Faktor F) + reduced employee base.
  let baseTotalKv: number, baseTotalRv: number, baseEmployee: number;
  if (kind === "midijob") {
    const G = p.minijobLimit;
    const O = p.midijobLimit;
    const F = p.midijobFactorF;
    const ae = input.monthlyGross;
    const beTotal = F * G + ((O / (O - G)) - (G / (O - G)) * F) * (ae - G);
    const beEmployee = (O / (O - G)) * (ae - G);
    baseTotalKv = beTotal;
    baseTotalRv = beTotal;
    baseEmployee = beEmployee;
    detail.beitragspflichtigeEinnahme = cent(beTotal);
    detail.beitragspflichtigeEinnahmeAN = cent(beEmployee);
  } else {
    baseTotalKv = Math.min(input.monthlyGross, p.bbgKvMonthly);
    baseTotalRv = Math.min(input.monthlyGross, p.bbgRvMonthly);
    baseEmployee = 0; // unused in standard path
  }

  const branch = (
    totalBase: number,
    totalRate: number,
    employeeRate: number,
  ): SvBranch => {
    if (kind === "midijob") {
      const total = cent(totalBase * totalRate);
      const employee = cent(baseEmployee * employeeRate);
      return { employee, employer: cent(total - employee) };
    }
    const employee = cent(totalBase * employeeRate);
    const employer = cent(totalBase * (totalRate - employeeRate));
    return { employee, employer };
  };

  const kv = input.inGkv ? branch(baseTotalKv, p.kvRate + zusatz, (p.kvRate + zusatz) / 2) : zero;
  const pv = input.inGkv ? branch(baseTotalKv, pvEeRate + pvErRate, pvEeRate) : zero;
  const rv = branch(baseTotalRv, p.rvRate, p.rvRate / 2);
  const av = branch(baseTotalRv, p.avRate, p.avRate / 2);

  // Umlagen on the RV-liable wage (employer only).
  const umlageBase = Math.min(input.monthlyGross, p.bbgRvMonthly);
  const u1 = cent(umlageBase * u1Rate);
  const u2 = cent(umlageBase * u2Rate);
  const inso = cent(umlageBase * p.insolvenzgeldUmlage);

  const totalEmployee = cent(kv.employee + rv.employee + av.employee + pv.employee);
  const totalEmployer = cent(kv.employer + rv.employer + av.employer + pv.employer + u1 + u2 + inso);

  return {
    kind,
    kv,
    rv,
    av,
    pv,
    umlagen: { u1, u2, insolvenz: inso },
    pauschsteuer: 0,
    totalEmployee,
    totalEmployer,
    pvEmployeeRate: pvEeRate,
    detail,
  };
}
