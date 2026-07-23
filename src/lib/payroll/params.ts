// Versioned German statutory payroll parameters (Steuer- + SV-Rechengrößen).
// NEVER hardcode any of these values elsewhere — always resolve via paramsForYear().
// Each yearly set is verified against official sources before `verified: true`.
//
// 2026 sources (checked 2026-07-07):
// - §32a EStG (gesetze-im-internet.de): Grundfreibetrag 12.348 €, zones 17.799/69.878/277.825,
//   coefficients (914,51 y + 1400) y | (173,10 z + 2397) z + 1034,87 | 0,42x − 11.135,63 | 0,45x − 19.470,38
// - §39b Abs. 2 S. 7 EStG: StKl V/VI min 14 %, 42 %-Kappung ab 14.071 €, 42 % ab 34.939 €, 45 % ab 222.260 €
// - SV-Rechengrößenverordnung 2026: BBG KV/PV 69.750 €/J (5.812,50 €/M), BBG RV/AV 101.400 €/J (8.450 €/M)
// - Beitragssätze 2026: KV 14,6 % + durchschn. Zusatzbeitrag 2,9 % (kassenindividuell!), RV 18,6 %,
//   AV 2,6 %, PV 3,6 % (+0,6 kinderlos, −0,25 je Kind 2–5 u. 25, Sachsen-Sonderverteilung)
// - Minijob-Grenze 603 €/M (Mindestlohn 13,90 €), Übergangsbereich bis 2.000 €, Faktor F 0,6619
// - Solidaritätszuschlag: Freigrenze 20.350 € (40.700 € StKl III), Milderungszone 11,9 %

export interface TaxTariff {
  /** §32a zone boundaries (zvE in full EUR). */
  grundfreibetrag: number;
  zone2End: number; // end of first progression zone
  zone3End: number; // end of second progression zone
  zone4End: number; // start of 45% above this
  /** §32a coefficients. */
  z2a: number; // (z2a·y + z2b)·y
  z2b: number;
  z3a: number; // (z3a·z + z3b)·z + z3c
  z3b: number;
  z3c: number;
  z4Rate: number; // 0.42
  z4Sub: number;
  z5Rate: number; // 0.45
  z5Sub: number;
  /** §39b Abs. 2 S. 7 — StKl V/VI bounding values. */
  kl56MinRate: number; // 0.14
  kl56Cap42From: number; // 42% cap applies to part above this
  kl56Flat42From: number;
  kl56Flat45From: number;
}

export interface PayrollParams {
  year: number;
  /** true only after every value has been checked against official publications. */
  verified: boolean;
  tariff: TaxTariff;
  /** Annual deductions used in the Lohnsteuer procedure (§39b). */
  arbeitnehmerPauschbetrag: number; // §9a — classes I–V
  sonderausgabenPauschbetrag: number; // §10c — classes I–V
  entlastungAlleinerziehende: number; // §24b — class II
  /** Full annual Kinderfreibetrag per Zähler 1,0 (sächlich + BEA), for KiSt/Soli only. */
  kinderfreibetragProZaehler: number;
  /** Solidaritätszuschlag. */
  soliRate: number; // 0.055
  soliFreigrenze: number; // annual LSt threshold (classes I/II/IV/V/VI)
  soliFreigrenzeSplitting: number; // class III
  soliMilderungRate: number; // 0.119
  /** Vorsorgepauschale (§39b Abs. 2 S. 5 Nr. 3, Abs. 4). */
  mindestVorsorgePauschale: number; // 12% cap, classes I/II/IV/V
  mindestVorsorgePauschaleIII: number; // class III
  mindestVorsorgeRate: number; // 0.12
  /** Sozialversicherung — monthly Beitragsbemessungsgrenzen. */
  bbgKvMonthly: number;
  bbgRvMonthly: number;
  /** Contribution rates (total, split 50/50 unless noted). */
  kvRate: number; // allgemeiner Beitragssatz
  kvZusatzDefault: number; // durchschnittlicher Zusatzbeitrag — per-employee Krankenkasse value overrides
  rvRate: number;
  avRate: number;
  pvRate: number; // total
  pvChildlessSurcharge: number; // employee-only, age ≥ 23
  pvChildDeductionPerKid: number; // employee-only, children 2–5 under 25
  pvSaxonyEmployeeExtra: number; // Saxony: employee bears this much more than half (0.5 pp)
  /** Minijob / Midijob (Übergangsbereich). */
  minijobLimit: number; // monthly
  midijobLimit: number; // monthly upper bound
  midijobFactorF: number;
  minijobPauschalKv: number; // employer flat, only if employee is in GKV
  minijobPauschalRv: number; // employer flat
  minijobPauschalTax: number; // 2% Pauschsteuer via Minijob-Zentrale
  /** Umlagen (employer-only). U1/U2 are Krankenkasse-specific — profile values override. */
  u1Default: number;
  u2Default: number;
  insolvenzgeldUmlage: number;
  /** Minimum wage (plausibility checks). */
  mindestlohn: number;
  notes: string[];
}

const PARAMS_2025: PayrollParams = {
  year: 2025,
  verified: true,
  tariff: {
    grundfreibetrag: 12_096,
    zone2End: 17_443,
    zone3End: 68_480,
    zone4End: 277_825,
    z2a: 932.3, z2b: 1400,
    z3a: 176.64, z3b: 2397, z3c: 1015.13,
    z4Rate: 0.42, z4Sub: 10_911.92,
    z5Rate: 0.45, z5Sub: 19_246.67,
    kl56MinRate: 0.14,
    kl56Cap42From: 13_785, // 2025 value per §39b(2) S.7
    kl56Flat42From: 34_240,
    kl56Flat45From: 222_260,
  },
  arbeitnehmerPauschbetrag: 1_230,
  sonderausgabenPauschbetrag: 36,
  entlastungAlleinerziehende: 4_260,
  kinderfreibetragProZaehler: 9_600, // 6.672 + 2.928
  soliRate: 0.055,
  soliFreigrenze: 19_950,
  soliFreigrenzeSplitting: 39_900,
  soliMilderungRate: 0.119,
  mindestVorsorgePauschale: 1_900,
  mindestVorsorgePauschaleIII: 3_000,
  mindestVorsorgeRate: 0.12,
  bbgKvMonthly: 5_512.5,
  bbgRvMonthly: 8_050,
  kvRate: 0.146,
  kvZusatzDefault: 0.025,
  rvRate: 0.186,
  avRate: 0.026,
  pvRate: 0.036,
  pvChildlessSurcharge: 0.006,
  pvChildDeductionPerKid: 0.0025,
  pvSaxonyEmployeeExtra: 0.005,
  minijobLimit: 556,
  midijobLimit: 2_000,
  midijobFactorF: 0.6683,
  minijobPauschalKv: 0.13,
  minijobPauschalRv: 0.15,
  minijobPauschalTax: 0.02,
  u1Default: 0.016,
  u2Default: 0.0044,
  insolvenzgeldUmlage: 0.0015,
  mindestlohn: 12.82,
  notes: [],
};

const PARAMS_2026: PayrollParams = {
  year: 2026,
  verified: true,
  tariff: {
    grundfreibetrag: 12_348,
    zone2End: 17_799,
    zone3End: 69_878,
    zone4End: 277_825,
    z2a: 914.51, z2b: 1400,
    z3a: 173.1, z3b: 2397, z3c: 1034.87,
    z4Rate: 0.42, z4Sub: 11_135.63,
    z5Rate: 0.45, z5Sub: 19_470.38,
    kl56MinRate: 0.14,
    kl56Cap42From: 14_071,
    kl56Flat42From: 34_939,
    kl56Flat45From: 222_260,
  },
  arbeitnehmerPauschbetrag: 1_230,
  sonderausgabenPauschbetrag: 36,
  entlastungAlleinerziehende: 4_260,
  kinderfreibetragProZaehler: 9_756, // 6.828 + 2.928 — StFortEntwG
  soliRate: 0.055,
  soliFreigrenze: 20_350,
  soliFreigrenzeSplitting: 40_700,
  soliMilderungRate: 0.119,
  mindestVorsorgePauschale: 1_900,
  mindestVorsorgePauschaleIII: 3_000,
  mindestVorsorgeRate: 0.12,
  bbgKvMonthly: 5_812.5, // 69.750 €/Jahr
  bbgRvMonthly: 8_450, // 101.400 €/Jahr
  kvRate: 0.146,
  kvZusatzDefault: 0.029, // durchschnittlicher Zusatzbeitrag 2026 — use the employee's Krankenkasse value!
  rvRate: 0.186,
  avRate: 0.026,
  pvRate: 0.036,
  pvChildlessSurcharge: 0.006,
  pvChildDeductionPerKid: 0.0025,
  pvSaxonyEmployeeExtra: 0.005,
  minijobLimit: 603, // Mindestlohn 13,90 € × 130/3
  midijobLimit: 2_000,
  midijobFactorF: 0.6619,
  minijobPauschalKv: 0.13,
  minijobPauschalRv: 0.15,
  minijobPauschalTax: 0.02,
  u1Default: 0.016, // Krankenkasse-specific — set per employee/org (Minijob-Zentrale has own rates)
  u2Default: 0.0044,
  insolvenzgeldUmlage: 0.0015, // 0,15 % — reconfirm each January
  mindestlohn: 13.9,
  notes: [
    "U1/U2 sind kassenindividuell — Defaults müssen je Krankenkasse überschrieben werden.",
    "Zusatzbeitrag ist kassenindividuell — der Durchschnittswert ist nur Fallback.",
  ],
};

const ALL: Record<number, PayrollParams> = { 2025: PARAMS_2025, 2026: PARAMS_2026 };

export function paramsForYear(year: number): PayrollParams {
  const p = ALL[year];
  if (!p) {
    throw new Error(
      `No statutory payroll parameters for ${year}. Add a verified parameter set to src/lib/payroll/params.ts before running payroll.`,
    );
  }
  return p;
}

export const SUPPORTED_PAYROLL_YEARS = Object.keys(ALL).map(Number).sort();
