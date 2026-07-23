// Payslip composer: profile + gross (+ optional Einmalzahlung) → complete
// Lohnabrechnung. Combines the Lohnsteuer engine (§39b Abs. 2 laufend + Abs. 3
// sonstige Bezüge) and the SV engine (laufend + §23a Einmalzahlung), plus the
// tax-free PKV employer subsidy (§3 Nr. 62 EStG, §257 SGB V).

import { calcLohnsteuer, calcLohnsteuerSonstigerBezug, type TaxClass } from "./lohnsteuer";
import {
  calcSozialversicherung, calcSvEinmalzahlung, classifyEmployment, pvEmployeeRateFor,
  type EmploymentKind,
} from "./sozialversicherung";
import { paramsForYear } from "./params";

export type ChurchTax = "none" | "rk" | "ev";

/** German states — drives church-tax rate (8 % BY/BW) and the Saxony PV split. */
export const BUNDESLAENDER = [
  "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
  "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
  "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt", "Schleswig-Holstein", "Thüringen",
] as const;
export type Bundesland = (typeof BUNDESLAENDER)[number];

export interface PayProfileInput {
  taxClass: TaxClass;
  kinderfreibetraege: number; // ELStAM Zähler
  church: ChurchTax;
  bundesland: Bundesland;
  inGkv: boolean;
  krankenkasse: string | null;
  kvZusatz: number | null; // the Krankenkasse's Zusatzbeitrag, e.g. 0.029
  pvChildless: boolean;
  childrenUnder25: number;
  minijobRvExempt: boolean;
  u1Rate: number | null;
  u2Rate: number | null;
  /** PKV monthly premiums (for the employer subsidy). Only used when !inGkv. */
  pkvPremiumKv: number | null;
  pkvPremiumPv: number | null;
}

export interface PayslipLine {
  code: string;
  label: string;
  /** Positive = payment/earning, negative = deduction (employee view). */
  amount: number;
  side: "earning" | "employee_deduction" | "employer_cost" | "info";
}

export interface PayslipResult {
  year: number;
  month: number; // 1–12
  employmentKind: EmploymentKind;
  gross: number; // laufend
  einmalzahlung: number;
  /** Tax-free employer PKV subsidy paid out with the wage. */
  pkvZuschuss: number;
  netto: number;
  totalEmployeeDeductions: number;
  totalEmployerCost: number; // gross + SB + employer SV + Umlagen + Pauschsteuer + PKV-Zuschuss
  lines: PayslipLine[];
  /** Combined (laufend + Einmalbezug) withholdings. */
  tax: { lohnsteuer: number; soli: number; kirchensteuer: number };
  sv: ReturnType<typeof calcSozialversicherung>;
  /** Audit trail for the Einmalzahlung portion. */
  sbDetail: {
    tax: { lohnsteuer: number; soli: number; kirchensteuer: number };
    svEmployee: number;
    svEmployer: number;
    baseKv: number;
    baseRv: number;
  } | null;
  paramsVersion: string;
  warnings: string[];
}

const churchRateFor = (church: ChurchTax, land: Bundesland): number => {
  if (church === "none") return 0;
  return land === "Bayern" || land === "Baden-Württemberg" ? 0.08 : 0.09;
};

const cent = (v: number) => Math.round(v * 100) / 100;

export function calcPayslip(opts: {
  year: number;
  month: number;
  monthlyGross: number;
  profile: PayProfileInput;
  hoursWorked?: number | null;
  hourlyWage?: number | null;
  /** Sonstiger Bezug (bonus, 13. Gehalt, Urlaubsgeld) paid this month. */
  einmalzahlung?: number | null;
  /** YTD SV-liable wage incl. current month laufend (for the anteilige Jahres-BBG). */
  ytd?: { kvBase: number; rvBase: number } | null;
}): PayslipResult {
  const { year, month, monthlyGross, profile } = opts;
  const p = paramsForYear(year);
  const warnings: string[] = [];
  const sb = Math.max(0, opts.einmalzahlung ?? 0);
  const kind = classifyEmployment(monthlyGross, p);

  // Minimum-wage plausibility.
  if (opts.hoursWorked && opts.hoursWorked > 0) {
    const effective = monthlyGross / opts.hoursWorked;
    if (effective < p.mindestlohn - 0.005) {
      warnings.push(
        `Effektiver Stundenlohn ${effective.toFixed(2)} € liegt unter dem Mindestlohn ${p.mindestlohn.toFixed(2)} € (MiLoG).`,
      );
    }
  }

  // Minijob: pauschal rates are flat, so the Einmalzahlung simply joins the base —
  // but it counts toward the annual limit (12 × 603 € in 2026).
  const svGross = kind === "minijob" ? monthlyGross + sb : monthlyGross;
  if (kind === "minijob" && sb > 0 && (monthlyGross * 12 + sb) / 12 > p.minijobLimit) {
    warnings.push(
      "Einmalzahlung lässt das regelmäßige Entgelt über die Minijob-Grenze steigen — Status prüfen (ggf. Midijob).",
    );
  }

  const sv = calcSozialversicherung({
    year,
    monthlyGross: svGross,
    inGkv: profile.inGkv,
    kvZusatz: profile.kvZusatz ?? undefined,
    pvChildless: profile.pvChildless,
    childrenUnder25: profile.childrenUnder25,
    inSaxony: profile.bundesland === "Sachsen",
    minijobRvExempt: profile.minijobRvExempt,
    u1Rate: profile.u1Rate ?? undefined,
    u2Rate: profile.u2Rate ?? undefined,
  });

  // Einmalzahlung SV (standard + midijob: full rates on the BBG-headroom-capped base).
  const sbSv =
    sb > 0 && sv.kind !== "minijob"
      ? calcSvEinmalzahlung({
          year,
          sonstigerBezug: sb,
          month,
          ytdKvBase: opts.ytd?.kvBase ?? Math.min(monthlyGross, p.bbgKvMonthly) * month,
          ytdRvBase: opts.ytd?.rvBase ?? Math.min(monthlyGross, p.bbgRvMonthly) * month,
          inGkv: profile.inGkv,
          kvZusatz: profile.kvZusatz ?? undefined,
          pvChildless: profile.pvChildless,
          childrenUnder25: profile.childrenUnder25,
          inSaxony: profile.bundesland === "Sachsen",
        })
      : null;
  if (sbSv && !opts.ytd) {
    warnings.push(
      "Einmalzahlung: Jahres-BBG-Prüfung basiert auf hochgerechnetem laufendem Lohn (keine JTD-Werte übergeben).",
    );
  }

  // Taxes. Minijob: 2 % Pauschsteuer replaces LSt/Soli/KiSt entirely.
  const churchRate = churchRateFor(profile.church, profile.bundesland);
  const pvEeRate = profile.inGkv
    ? pvEmployeeRateFor(
        { pvChildless: profile.pvChildless, childrenUnder25: profile.childrenUnder25, inSaxony: profile.bundesland === "Sachsen" },
        p,
      )
    : 0;
  const taxBase = {
    year,
    monthlyGross,
    taxClass: profile.taxClass,
    kinderfreibetraege: profile.kinderfreibetraege,
    churchRate,
    inGkv: profile.inGkv,
    kvZusatz: profile.kvZusatz ?? undefined,
    inRv: true,
    pvEmployeeRate: pvEeRate,
  };
  const laufendTax =
    sv.kind === "minijob"
      ? { lohnsteuer: 0, soli: 0, kirchensteuer: 0 }
      : (() => {
          const r = calcLohnsteuer(taxBase);
          return { lohnsteuer: r.lohnsteuer, soli: r.soli, kirchensteuer: r.kirchensteuer };
        })();
  const sbTax =
    sv.kind === "minijob" || sb <= 0
      ? { lohnsteuer: 0, soli: 0, kirchensteuer: 0 }
      : calcLohnsteuerSonstigerBezug(taxBase, sb);

  const tax = {
    lohnsteuer: cent(laufendTax.lohnsteuer + sbTax.lohnsteuer),
    soli: cent(laufendTax.soli + sbTax.soli),
    kirchensteuer: cent(laufendTax.kirchensteuer + sbTax.kirchensteuer),
  };

  // PKV employer subsidy (§257 SGB V): half the premium, capped at the statutory
  // maximum (half of the max GKV contribution at the BBG). Tax-free (§3 Nr. 62).
  let pkvZuschuss = 0;
  if (!profile.inGkv && sv.kind !== "minijob") {
    const premiumKv = profile.pkvPremiumKv ?? 0;
    const premiumPv = profile.pkvPremiumPv ?? 0;
    if (premiumKv > 0 || premiumPv > 0) {
      const zusatz = profile.kvZusatz ?? p.kvZusatzDefault;
      const maxKv = p.bbgKvMonthly * ((p.kvRate + zusatz) / 2);
      const pvErRate = profile.bundesland === "Sachsen" ? p.pvRate / 2 - p.pvSaxonyEmployeeExtra : p.pvRate / 2;
      const maxPv = p.bbgKvMonthly * pvErRate;
      pkvZuschuss = cent(Math.min(premiumKv / 2, maxKv) + Math.min(premiumPv / 2, maxPv));
    } else {
      warnings.push(
        "Privat krankenversichert ohne hinterlegte Prämie — AG-Zuschuss (§257 SGB V) kann nicht berechnet werden.",
      );
    }
  }

  const sbSvEmployee = sbSv?.totalEmployee ?? 0;
  const sbSvEmployer = sbSv?.totalEmployer ?? 0;
  const totalEmployeeDeductions = cent(
    tax.lohnsteuer + tax.soli + tax.kirchensteuer + sv.totalEmployee + sbSvEmployee,
  );
  const totalGross = cent(monthlyGross + sb);
  const netto = cent(totalGross + pkvZuschuss - totalEmployeeDeductions);
  const totalEmployerCost = cent(totalGross + sv.totalEmployer + sbSvEmployer + pkvZuschuss);

  // Combined branch amounts for the payslip lines (laufend + Einmalbezug).
  const kvAn = cent(sv.kv.employee + (sbSv?.kv.employee ?? 0));
  const rvAn = cent(sv.rv.employee + (sbSv?.rv.employee ?? 0));
  const avAn = cent(sv.av.employee + (sbSv?.av.employee ?? 0));
  const pvAn = cent(sv.pv.employee + (sbSv?.pv.employee ?? 0));
  const kvAg = cent(sv.kv.employer + (sbSv?.kv.employer ?? 0));
  const rvAg = cent(sv.rv.employer + (sbSv?.rv.employer ?? 0));
  const avAg = cent(sv.av.employer + (sbSv?.av.employer ?? 0));
  const pvAg = cent(sv.pv.employer + (sbSv?.pv.employer ?? 0));
  const inso = cent(sv.umlagen.insolvenz + (sbSv?.insolvenz ?? 0));

  const allLines: PayslipLine[] = [
    ...(opts.hoursWorked && opts.hourlyWage
      ? [{ code: "hours", label: `Stundenlohn ${opts.hourlyWage.toFixed(2)} € × ${opts.hoursWorked.toFixed(2)} h`, amount: cent(opts.hourlyWage * opts.hoursWorked), side: "earning" as const }]
      : [{ code: "salary", label: "Gehalt / Lohn (laufend)", amount: monthlyGross, side: "earning" as const }]),
    { code: "einmalzahlung", label: "Einmalzahlung (sonstiger Bezug)", amount: sb, side: "earning" },
    { code: "pkv_zuschuss", label: "AG-Zuschuss PKV (steuerfrei, §257 SGB V)", amount: pkvZuschuss, side: "earning" },
    { code: "lst", label: "Lohnsteuer", amount: -tax.lohnsteuer, side: "employee_deduction" },
    { code: "soli", label: "Solidaritätszuschlag", amount: -tax.soli, side: "employee_deduction" },
    { code: "kist", label: "Kirchensteuer", amount: -tax.kirchensteuer, side: "employee_deduction" },
    { code: "kv_an", label: "Krankenversicherung (AN)", amount: -kvAn, side: "employee_deduction" },
    { code: "rv_an", label: "Rentenversicherung (AN)", amount: -rvAn, side: "employee_deduction" },
    { code: "av_an", label: "Arbeitslosenversicherung (AN)", amount: -avAn, side: "employee_deduction" },
    { code: "pv_an", label: "Pflegeversicherung (AN)", amount: -pvAn, side: "employee_deduction" },
    { code: "kv_ag", label: "Krankenversicherung (AG)", amount: kvAg, side: "employer_cost" },
    { code: "rv_ag", label: "Rentenversicherung (AG)", amount: rvAg, side: "employer_cost" },
    { code: "av_ag", label: "Arbeitslosenversicherung (AG)", amount: avAg, side: "employer_cost" },
    { code: "pv_ag", label: "Pflegeversicherung (AG)", amount: pvAg, side: "employer_cost" },
    { code: "u1", label: "Umlage U1 (Lohnfortzahlung)", amount: sv.umlagen.u1, side: "employer_cost" },
    { code: "u2", label: "Umlage U2 (Mutterschaft)", amount: sv.umlagen.u2, side: "employer_cost" },
    { code: "inso", label: "Insolvenzgeldumlage", amount: inso, side: "employer_cost" },
    ...(sv.pauschsteuer > 0
      ? [{ code: "pauschsteuer", label: "Pauschsteuer 2 % (Minijob-Zentrale)", amount: sv.pauschsteuer, side: "employer_cost" as const }]
      : []),
  ];
  const lines = allLines.filter((l) => l.amount !== 0);

  return {
    year,
    month,
    employmentKind: sv.kind,
    gross: monthlyGross,
    einmalzahlung: sb,
    pkvZuschuss,
    netto,
    totalEmployeeDeductions,
    totalEmployerCost,
    lines,
    tax,
    sv,
    sbDetail:
      sb > 0
        ? {
            tax: sbTax,
            svEmployee: sbSvEmployee,
            svEmployer: sbSvEmployer,
            baseKv: sbSv?.baseKv ?? (sv.kind === "minijob" ? sb : 0),
            baseRv: sbSv?.baseRv ?? (sv.kind === "minijob" ? sb : 0),
          }
        : null,
    paramsVersion: `${year}${p.verified ? "" : "-UNVERIFIED"}`,
    warnings,
  };
}
