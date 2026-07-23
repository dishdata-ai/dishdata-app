# DishData Payroll — German Lohnabrechnung

Full statutory German payroll calculation, built in-app. Every euro on a payslip is
computed from the versioned parameter sets in `params.ts` — nothing is hardcoded,
and every yearly set is checked against official publications before `verified: true`.

## Phase L2 (built)

- **Einmalzahlungen / sonstige Bezüge** (`calcLohnsteuerSonstigerBezug`): §39b Abs. 3
  annual-difference method for LSt/Soli/KiSt; SV per §23a SGB IV at full rates
  (no Übergangsbereich reduction) capped by the anteilige Jahres-BBG headroom
  (`calcSvEinmalzahlung`; YTD bases optional — falls back to projected steady wage
  with a warning). Not umlagepflichtig for U1/U2; InsO-Umlage applies.
  **Märzklausel not implemented** — January–March one-offs that belong to the prior
  year's BBG are not re-attributed; warn users until Phase L3.
- **PKV-Arbeitgeberzuschuss** (§257 SGB V, tax-free §3 Nr. 62): half the recorded
  premium, capped at the statutory max (half max GKV contribution at the BBG;
  Saxony PV split respected). Profile fields `pkv_premium_kv/pv`.
- **Printable payslip** (`payslip-print.ts`): EBV-structured Verdienstabrechnung,
  browser print → PDF.
- **Authority reports** (`reports.ts`): Lohnsteuer-Anmeldung values (Kz 42/48 + KiSt,
  §41a EStG) and Beitragsnachweise per Einzugsstelle (Krankenkassen; Minijobs
  grouped to the Minijob-Zentrale) — exactly the numbers ELSTER/SV-Meldeportal ask for.
- Migration `0015_payroll_l2.sql` (PKV premium fields, einmalzahlung/pkv_zuschuss columns).

## What is implemented (Phase L1)

**Lohnsteuer (`lohnsteuer.ts`)** — §39b EStG monthly procedure following the BMF
Programmablaufplan structure:
- §32a tariff 2025 + 2026 (exact zone boundaries and coefficients from gesetze-im-internet.de)
- Tax classes I–VI: Grundtarif, III Splitting, V/VI per §39b Abs. 2 S. 7 (PAP MST5_6:
  doubling formula, 14 % floor, 42 % growth cap, flat 42 %/45 % bands)
- Vorsorgepauschale (RV share + max(actual KV/PV employee shares, 12 % Mindest-VSP,
  capped 1.900 €/3.000 € StKl III); no Mindest-VSP in StKl VI)
- Arbeitnehmer-Pauschbetrag, Sonderausgaben-Pauschbetrag, Entlastungsbetrag (StKl II)
- Kinderfreibeträge (ELStAM Zähler) — reduce only Soli + Kirchensteuer (§51a)
- Solidaritätszuschlag with Freigrenze (20.350 €/40.700 € in 2026) + 11,9 % Milderungszone
- Kirchensteuer 8 % (BY/BW) / 9 % (rest)
- PAP rounding: zvE/tax floored to full EUR, VSP parts ceiled, monthly floored to cent

**Sozialversicherung (`sozialversicherung.ts`)**:
- KV (14,6 % + kassenindividueller Zusatzbeitrag), RV 18,6 %, AV 2,6 %, PV 3,6 %
- PV extras: +0,6 % kinderlos (≥23 J.), −0,25 %/Kind 2–5 unter 25, Sachsen-Sonderverteilung
- Beitragsbemessungsgrenzen (2026: KV 5.812,50 €/M, RV 8.450 €/M)
- **Minijob** (≤ 603 €/M 2026): AG-Pauschalen 13 % KV (nur GKV) + 15 % RV + 2 % Pauschsteuer,
  AN RV-Aufstockung 3,6 % (Mindestbemessung 175 €) mit Befreiungsoption
- **Midijob/Übergangsbereich** (603,01–2.000 €): Faktor F (2026: 0,6619), reduzierte
  beitragspflichtige Einnahme für AN, AG trägt die Differenz — kein Beitragssprung an
  den Grenzen (selfcheck-verified)
- Umlagen: U1/U2 (kassenindividuell, Profile überschreiben Defaults), Insolvenzgeldumlage

**Composer (`run.ts`)** — payslip line items (earnings / AN-Abzüge / AG-Kosten),
Netto, Arbeitgeber-Gesamtkosten, MiLoG minimum-wage plausibility warning.

**Persistence (`0014_payroll.sql`)** — pay_profiles (ELStAM + SV data),
payroll_runs (draft → finalized), payslips (full line-item + calc audit trail).
Finalized runs are **immutable via DB trigger** (GoBD). RLS: **owner/admin only** —
payroll is the most sensitive data in the app (DSGVO).

**UI (`src/views/Payroll.tsx`)** — run view (hours from the time clock, live calc,
draft/finalize) + profile editor. Module id `payroll`, People group.

**Verification** — `scripts/payroll-selfcheck.ts` (45 checks): tariff-zone continuity,
monotonicity, splitting identity, hand-computed SV reference values, BBG capping,
Saxony/childless/children PV variants, minijob/midijob boundary continuity, payslip
line-sum invariants. Run: `npx tsx scripts/payroll-selfcheck.ts`.

## Honest legal/technical boundaries (as of 2026-07)

| Area | Status | Path |
| --- | --- | --- |
| Wage tax + SV calculation | ✅ in-app, deterministic | validate against official BMF PAP test cases before first real payroll |
| ELStAM retrieval | ❌ needs ERiC/ELSTER cert | enter from employee's Bescheinigung; ERiC integration Phase L3 |
| Lohnsteueranmeldung | values computed | manual entry in ELSTER portal until ERiC (Phase L3) |
| DEÜV/SV-Meldungen (Anmeldung, Jahresmeldung…) | ❌ needs ITSG-Systemuntersuchung | use free SV-Meldeportal with app-generated values; certification long-term |
| Beitragsnachweis an Krankenkassen | values computed (monthly AG totals) | SV-Meldeportal until certified |
| Payslip PDF | ✅ print view (EBV structure) | letterhead/branding later |
| Einmalzahlungen | ✅ §39b(3) + §23a | Märzklausel missing (Phase L3) |
| PKV-AG-Zuschuss | ✅ §257 SGB V | PKV Basisvorsorge in VSP still approximated via Mindest-VSP |
| Lohnsteueranmeldung + Beitragsnachweis values | ✅ per run | manual portal entry until ERiC/ITSG |
| Lohnfortzahlung/U1-Erstattung, bAV, VWL, geldwerter Vorteil (1 %-Regelung) | Phase L3 | |
| BG/UV-Jahresmeldung, Lohnsteuerbescheinigung (year-end) | Phase L3 | |
| DATEV LODAS/Lohn export | Phase L3 | |

## Operating rules

1. **Never run a year without a `verified` parameter set** — `paramsForYear` throws by design.
2. **Zusatzbeitrag + U1/U2 are kassenindividuell** — set them per employee from the
   Krankenkasse's notice; the defaults are only statistical averages.
3. Einmalzahlungen in January–March: check the Märzklausel manually (attribution to
   the previous year when the current year's anteilige BBG is exceeded) — not automated yet.
4. Each January: add the new parameter set (BBGs, Faktor F, tariff, Minijob-Grenze,
   durchschn. Zusatzbeitrag, Soli-Freigrenze, Insolvenzgeldumlage) and re-run the selfcheck.
