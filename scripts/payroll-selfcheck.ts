// Payroll engine self-check: statutory invariants + hand-verifiable reference values.
// Run: npx tsx scripts/payroll-selfcheck.ts
// This is NOT a substitute for validating against the official BMF PAP test cases
// (lohnsteuer-programmablaufplan test suite) before production use — see README.

import { calcLohnsteuer, calcLohnsteuerSonstigerBezug, grundtarif, taxForClass } from "../src/lib/payroll/lohnsteuer";
import { calcSozialversicherung, calcSvEinmalzahlung } from "../src/lib/payroll/sozialversicherung";
import { calcPayslip } from "../src/lib/payroll/run";
import { paramsForYear } from "../src/lib/payroll/params";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (!cond) {
    failures++;
    console.error(`  FAIL  ${name} ${detail}`);
  } else {
    console.log(`  ok    ${name}`);
  }
};
const approx = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

const p26 = paramsForYear(2026);
const t = p26.tariff;

console.log("== §32a tariff 2026 ==");
// Below Grundfreibetrag → 0.
check("zvE 12.348 → 0 €", grundtarif(12_348, t) === 0);
// Zone 2 lower edge: one euro above GFB ≈ 0 (floors to 0).
check("zvE 12.349 → 0 €", grundtarif(12_349, t) === 0);
// Zone boundary continuity: tax at zone2End computed by both formulas within 1 €.
const yEnd = (t.zone2End - t.grundfreibetrag) / 10_000;
const viaZone2 = (t.z2a * yEnd + t.z2b) * yEnd;
check("zone2/zone3 continuity", Math.abs(viaZone2 - t.z3c) < 1.5, `${viaZone2.toFixed(2)} vs ${t.z3c}`);
// Zone 3/4 boundary: quadratic ≈ linear at 69.878.
const zEnd = (t.zone3End - t.zone2End) / 10_000;
const viaZone3 = (t.z3a * zEnd + t.z3b) * zEnd + t.z3c;
const viaZone4 = t.z4Rate * t.zone3End - t.z4Sub;
check("zone3/zone4 continuity", Math.abs(viaZone3 - viaZone4) < 1.5, `${viaZone3.toFixed(2)} vs ${viaZone4.toFixed(2)}`);
// 42/45 boundary.
check(
  "zone4/zone5 continuity",
  Math.abs(t.z4Rate * t.zone4End - t.z4Sub - (t.z5Rate * t.zone4End - t.z5Sub)) < 1.5,
);
// Monotonicity sweep.
let prev = 0;
let mono = true;
for (let x = 10_000; x <= 300_000; x += 500) {
  const v = grundtarif(x, t);
  if (v < prev) mono = false;
  prev = v;
}
check("monotonic 10k–300k", mono);
// Splitting: class III on 60k = 2 × tax(30k).
check("class III = splitting", taxForClass(60_000, 3, t) === 2 * grundtarif(30_000, t));
// Class V ≥ class I at mid income; min 14 % floor near bottom.
check("class V ≥ class I @30k", taxForClass(30_000, 5, t) >= taxForClass(30_000, 1, t));
check("class V min 14 % @10k", taxForClass(10_000, 5, t) >= Math.floor(10_000 * 0.14));

console.log("== Lohnsteuer monthly 2026 ==");
const base = { year: 2026, taxClass: 1 as const, kinderfreibetraege: 0, churchRate: 0, inGkv: true, kvZusatz: 0.029, inRv: true, pvEmployeeRate: 0.024 };
// €1.200/mo class I → far below effective threshold after deductions → 0 LSt.
check("1.200 €/M StKl I → LSt 0", calcLohnsteuer({ ...base, monthlyGross: 1_200 }).lohnsteuer === 0);
// Monotonic in gross.
const l2 = calcLohnsteuer({ ...base, monthlyGross: 2_500 }).lohnsteuer;
const l3 = calcLohnsteuer({ ...base, monthlyGross: 3_500 }).lohnsteuer;
const l4 = calcLohnsteuer({ ...base, monthlyGross: 5_000 }).lohnsteuer;
check("LSt monotonic 2.5k<3.5k<5k", l2 < l3 && l3 < l4, `${l2} / ${l3} / ${l4}`);
// Class III less than class I.
const l3k1 = calcLohnsteuer({ ...base, monthlyGross: 4_000 }).lohnsteuer;
const l3k3 = calcLohnsteuer({ ...base, monthlyGross: 4_000, taxClass: 3 }).lohnsteuer;
check("StKl III < StKl I @4k", l3k3 < l3k1, `${l3k3} vs ${l3k1}`);
// Church tax ≈ 9 % of kid-reduced LSt.
const withKist = calcLohnsteuer({ ...base, monthlyGross: 4_000, churchRate: 0.09 });
check("KiSt ≈ 9 % LSt", approx(withKist.kirchensteuer, (withKist.annual.lohnsteuerKids * 0.09) / 12, 0.02));
// Kinderfreibeträge reduce KiSt but not LSt.
const kids = calcLohnsteuer({ ...base, monthlyGross: 4_000, churchRate: 0.09, kinderfreibetraege: 2 });
check("Kids: LSt unchanged", kids.lohnsteuer === withKist.lohnsteuer);
check("Kids: KiSt lower", kids.kirchensteuer < withKist.kirchensteuer);
// Soli: 0 at normal gastro wages (Freigrenze 20.350 € annual LSt ⇒ ~ >8.3k/mo).
check("Soli 0 @5k/M", calcLohnsteuer({ ...base, monthlyGross: 5_000 }).soli === 0);
const soliHigh = calcLohnsteuer({ ...base, monthlyGross: 12_000 });
check("Soli > 0 @12k/M", soliHigh.soli > 0);
check(
  "Soli ≤ 5,5 % LStKids",
  soliHigh.soli <= (soliHigh.annual.lohnsteuerKids * 0.055) / 12 + 0.01,
);

console.log("== Sozialversicherung 2026 ==");
const svBase = { year: 2026, inGkv: true, kvZusatz: 0.029, pvChildless: true, childrenUnder25: 0, inSaxony: false, minijobRvExempt: false };
// Hand-computed standard case @3.000 €: KV AN 262,50 / RV AN 279,00 / AV AN 39,00 / PV AN 72,00.
const sv3k = calcSozialversicherung({ ...svBase, monthlyGross: 3_000 });
check("KV AN 262,50 @3k", approx(sv3k.kv.employee, 262.5), `${sv3k.kv.employee}`);
check("RV AN 279,00 @3k", approx(sv3k.rv.employee, 279), `${sv3k.rv.employee}`);
check("AV AN 39,00 @3k", approx(sv3k.av.employee, 39), `${sv3k.av.employee}`);
check("PV AN (kinderlos) 72,00 @3k", approx(sv3k.pv.employee, 72), `${sv3k.pv.employee}`);
check("PV AG 54,00 @3k", approx(sv3k.pv.employer, 54), `${sv3k.pv.employer}`);
// Child deductions: 3 kids under 25 → employee PV 1,8 − 0,5 = 1,3 % → 39,00.
const svKids = calcSozialversicherung({ ...svBase, monthlyGross: 3_000, pvChildless: false, childrenUnder25: 3 });
check("PV AN 3 Kinder 39,00 @3k", approx(svKids.pv.employee, 39), `${svKids.pv.employee}`);
// BBG capping @10k: KV base 5.812,50, RV base 8.450.
const sv10k = calcSozialversicherung({ ...svBase, monthlyGross: 10_000 });
check("KV AN capped 508,59 @10k", approx(sv10k.kv.employee, (5_812.5 * 0.175) / 2), `${sv10k.kv.employee}`);
check("RV AN capped 785,85 @10k", approx(sv10k.rv.employee, 8_450 * 0.093), `${sv10k.rv.employee}`);
// Saxony: employee pays 0,5 pp more, employer less.
const svSax = calcSozialversicherung({ ...svBase, monthlyGross: 3_000, inSaxony: true });
check("Sachsen PV AN 87,00 @3k", approx(svSax.pv.employee, 87), `${svSax.pv.employee}`);
check("Sachsen PV AG 39,00 @3k", approx(svSax.pv.employer, 39), `${svSax.pv.employer}`);
// Minijob @603: AN only RV top-up 3,6 % = 21,71; AG 13+15+2 % + Umlagen.
const svMini = calcSozialversicherung({ ...svBase, monthlyGross: 603 });
check("Minijob kind", svMini.kind === "minijob");
check("Minijob AN RV 21,71", approx(svMini.rv.employee, 21.71), `${svMini.rv.employee}`);
check("Minijob AG KV 78,39", approx(svMini.kv.employer, 78.39), `${svMini.kv.employer}`);
check("Minijob AG RV 90,45", approx(svMini.rv.employer, 90.45), `${svMini.rv.employer}`);
check("Minijob Pauschsteuer 12,06", approx(svMini.pauschsteuer, 12.06), `${svMini.pauschsteuer}`);
// Minijob RV-exempt → zero employee deduction.
const svMiniEx = calcSozialversicherung({ ...svBase, monthlyGross: 603, minijobRvExempt: true });
check("Minijob befreit AN 0", svMiniEx.totalEmployee === 0);
// Midijob: reduced employee share vs standard formula, employer+employee = full contribution on BE.
const svMidi = calcSozialversicherung({ ...svBase, monthlyGross: 1_200 });
check("Midijob kind @1.200", svMidi.kind === "midijob");
const fullEeAt1200 = 1_200 * (0.175 / 2 + 0.093 + 0.013 + 0.024);
check("Midijob AN < voller AN-Anteil", svMidi.totalEmployee < fullEeAt1200, `${svMidi.totalEmployee} vs ${fullEeAt1200.toFixed(2)}`);
// Übergangsbereich continuity at the top: @2.000 employee share ≈ standard share.
const svTop = calcSozialversicherung({ ...svBase, monthlyGross: 2_000 });
const fullEeAt2000 = 2_000 * (0.175 / 2 + 0.093 + 0.013 + 0.024);
check("Midijob @2.000 ≈ Standard", approx(svTop.totalEmployee, fullEeAt2000, 1), `${svTop.totalEmployee} vs ${fullEeAt2000.toFixed(2)}`);
const svAbove = calcSozialversicherung({ ...svBase, monthlyGross: 2_000.01 });
check("kein Sprung an 2.000-Grenze", Math.abs(svAbove.totalEmployee - svTop.totalEmployee) < 1.5, `${svTop.totalEmployee} → ${svAbove.totalEmployee}`);

console.log("== Payslip composition ==");
const profile = {
  taxClass: 1 as const, kinderfreibetraege: 0, church: "none" as const,
  bundesland: "Berlin" as const, inGkv: true, krankenkasse: "TK", kvZusatz: 0.029,
  pvChildless: true, childrenUnder25: 0, minijobRvExempt: false, u1Rate: null, u2Rate: null,
  pkvPremiumKv: null as number | null, pkvPremiumPv: null as number | null,
};
const slip = calcPayslip({ year: 2026, month: 1, monthlyGross: 3_000, profile });
check("Netto = Brutto − Abzüge", approx(slip.netto, slip.gross - slip.totalEmployeeDeductions));
const sumDeductions = slip.lines.filter((l) => l.side === "employee_deduction").reduce((s, l) => s - l.amount, 0);
check("Zeilensumme = Abzüge", approx(sumDeductions, slip.totalEmployeeDeductions), `${sumDeductions} vs ${slip.totalEmployeeDeductions}`);
check("AG-Kosten > Brutto", slip.totalEmployerCost > slip.gross);
console.log(`     → 3.000 € brutto, StKl I, kinderlos, Berlin: netto ${slip.netto.toFixed(2)} €, AG-Kosten ${slip.totalEmployerCost.toFixed(2)} €, LSt ${slip.tax.lohnsteuer.toFixed(2)} €`);
// Sanity band: net ratio for 3k class I childless (2026: 68,6 % — hand-verified:
// VSP 7.362 → zvE 27.372 → §32a 3.488 €/J → LSt 290,66 €/M; SV 652,50 €/M).
check("Netto-Quote plausibel (62–70 %)", slip.netto / slip.gross > 0.62 && slip.netto / slip.gross < 0.7, `${((slip.netto / slip.gross) * 100).toFixed(1)} %`);
// Mindestlohn warning fires.
const cheap = calcPayslip({ year: 2026, month: 1, monthlyGross: 1_000, profile, hoursWorked: 100, hourlyWage: 10 });
check("MiLoG-Warnung", cheap.warnings.some((w) => w.includes("Mindestlohn")));
// Minijob slip: no LSt lines, Pauschsteuer employer cost present.
const mini = calcPayslip({ year: 2026, month: 1, monthlyGross: 520, profile });
check("Minijob: keine LSt", mini.tax.lohnsteuer === 0);
check("Minijob: Pauschsteuer AG", mini.lines.some((l) => l.code === "pauschsteuer"));

console.log("== Phase L2: Einmalzahlung + PKV-Zuschuss ==");
// §39b Abs. 3: LSt on bonus = annual difference. 3.000 €/M + 3.000 € bonus.
const sbTax = calcLohnsteuerSonstigerBezug({ ...base, monthlyGross: 3_000 }, 3_000);
const a36 = calcLohnsteuer({ ...base, monthlyGross: 3_000 }).annual.lohnsteuer;
check("SB-LSt > 0", sbTax.lohnsteuer > 0, `${sbTax.lohnsteuer}`);
// Marginal rate on the bonus must exceed the average rate but stay < 45 %.
check("SB-LSt plausibel (Grenzsteuersatz)", sbTax.lohnsteuer / 3_000 > a36 / 36_000 && sbTax.lohnsteuer / 3_000 < 0.45, `${((sbTax.lohnsteuer / 3_000) * 100).toFixed(1)} %`);
// Zero bonus → zero tax.
check("SB 0 → 0", calcLohnsteuerSonstigerBezug({ ...base, monthlyGross: 3_000 }, 0).lohnsteuer === 0);
// SB-SV: full BBG headroom in July (month 7) for a 3k earner → fully liable.
const sbSv = calcSvEinmalzahlung({ year: 2026, sonstigerBezug: 3_000, month: 7, ytdKvBase: 21_000, ytdRvBase: 21_000, inGkv: true, kvZusatz: 0.029, pvChildless: true, childrenUnder25: 0, inSaxony: false });
check("SB-SV volle Basis", sbSv.baseKv === 3_000 && sbSv.baseRv === 3_000);
check("SB-SV AN = 652,50", approx(sbSv.totalEmployee, 652.5), `${sbSv.totalEmployee}`);
// High earner: KV headroom exhausted, RV partially. 8.000 €/M in month 2, 10.000 € bonus.
const sbSvHigh = calcSvEinmalzahlung({ year: 2026, sonstigerBezug: 10_000, month: 2, ytdKvBase: 5_812.5 * 2, ytdRvBase: 16_000, inGkv: true, kvZusatz: 0.029, pvChildless: true, childrenUnder25: 0, inSaxony: false });
check("SB-SV KV-Basis 0 (BBG voll)", sbSvHigh.baseKv === 0);
check("SB-SV RV-Basis 900 (Resthöhe)", approx(sbSvHigh.baseRv, 8_450 * 2 - 16_000), `${sbSvHigh.baseRv}`);
// Payslip with bonus: netto increases but less than the bonus.
const slipSb = calcPayslip({ year: 2026, month: 7, monthlyGross: 3_000, profile, einmalzahlung: 3_000 });
check("Slip SB: netto steigt", slipSb.netto > slip.netto);
check("Slip SB: netto < brutto+SB", slipSb.netto < slip.netto + 3_000);
check("Slip SB: Zeilensumme konsistent", approx(slipSb.lines.filter((l) => l.side === "employee_deduction").reduce((s, l) => s - l.amount, 0), slipSb.totalEmployeeDeductions), `${slipSb.totalEmployeeDeductions}`);
// PKV subsidy: premium 800/80 → Zuschuss = min(400, max) + min(40, max) = 440.
const pkvProfile = { ...profile, inGkv: false, pkvPremiumKv: 800, pkvPremiumPv: 80 };
const slipPkv = calcPayslip({ year: 2026, month: 1, monthlyGross: 6_000, profile: pkvProfile });
check("PKV-Zuschuss 440,00", approx(slipPkv.pkvZuschuss, 440), `${slipPkv.pkvZuschuss}`);
// Cap: huge premium capped at statutory max (KV 508,59 + PV 104,63).
const slipPkvCap = calcPayslip({ year: 2026, month: 1, monthlyGross: 6_000, profile: { ...pkvProfile, pkvPremiumKv: 2_000, pkvPremiumPv: 400 } });
check("PKV-Zuschuss gedeckelt 613,22", approx(slipPkvCap.pkvZuschuss, 5_812.5 * 0.0875 + 5_812.5 * 0.018, 0.02), `${slipPkvCap.pkvZuschuss}`);
check("PKV ohne Prämie → Warnung", calcPayslip({ year: 2026, month: 1, monthlyGross: 6_000, profile: { ...profile, inGkv: false } }).warnings.some((w) => w.includes("Prämie")));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
