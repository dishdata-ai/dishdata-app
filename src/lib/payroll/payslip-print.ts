// Printable payslip (Verdienstabrechnung) — opens the browser print dialog;
// "Save as PDF" gives the employee copy. Layout follows the structure required
// by the Entgeltbescheinigungsverordnung (EBV): employer/employee identity block,
// Bezüge, gesetzliche Abzüge, Auszahlungsbetrag, AG-Anteile separately.

import type { PayslipLine } from "./run";

export interface PrintSlip {
  employeeName: string;
  orgName: string;
  period: string; // e.g. "2026-07"
  employmentKind: string;
  taxClass?: number | string | null;
  krankenkasse?: string | null;
  svNumber?: string | null;
  iban?: string | null;
  gross: number;
  netto: number;
  employerCost: number;
  lines: PayslipLine[];
  warnings?: string[];
}

const eur = (v: number) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KIND_DE: Record<string, string> = {
  standard: "sozialversicherungspflichtig",
  minijob: "geringfügig beschäftigt (Minijob)",
  midijob: "Übergangsbereich (Midijob)",
};

export function buildPayslipHtml(s: PrintSlip): string {
  const earnings = s.lines.filter((l) => l.side === "earning");
  const deductions = s.lines.filter((l) => l.side === "employee_deduction");
  const employer = s.lines.filter((l) => l.side === "employer_cost");
  const row = (l: PayslipLine) =>
    `<tr><td>${esc(l.label)}</td><td class="num">${eur(l.amount)}</td></tr>`;

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Verdienstabrechnung ${esc(s.period)} — ${esc(s.employeeName)}</title>
<style>
  body { font: 12px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 16px; margin: 0 0 2px; } h2 { font-size: 12px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #444; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 12px; }
  .meta div { font-size: 11px; color: #333; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 4px; border-bottom: 1px solid #eee; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { border-top: 1.5px solid #111; border-bottom: none; font-weight: 700; }
  .warn { color: #92400e; background: #fef3c7; padding: 6px 8px; border-radius: 4px; margin-top: 10px; font-size: 11px; }
  .foot { margin-top: 24px; font-size: 10px; color: #777; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<h1>Verdienstabrechnung ${esc(s.period)}</h1>
<div class="meta">
  <div><strong>${esc(s.orgName)}</strong><br>Arbeitgeber</div>
  <div style="text-align:right"><strong>${esc(s.employeeName)}</strong><br>
    ${s.taxClass ? `Steuerklasse ${esc(String(s.taxClass))} · ` : ""}${esc(KIND_DE[s.employmentKind] ?? s.employmentKind)}<br>
    ${s.krankenkasse ? `KK: ${esc(s.krankenkasse)} · ` : ""}${s.svNumber ? `SV-Nr.: ${esc(s.svNumber)}` : ""}</div>
</div>
<h2>Bezüge</h2>
<table>${earnings.map(row).join("")}
<tr class="total"><td>Gesamtbrutto</td><td class="num">${eur(earnings.reduce((a, l) => a + l.amount, 0))}</td></tr></table>
<h2>Gesetzliche Abzüge</h2>
<table>${deductions.map(row).join("")}
<tr class="total"><td>Auszahlungsbetrag</td><td class="num">${eur(s.netto)}</td></tr></table>
${s.iban ? `<p style="font-size:11px;color:#333">Zahlung auf ${esc(s.iban)}</p>` : ""}
<h2>Arbeitgeberanteile &amp; Umlagen (nachrichtlich)</h2>
<table>${employer.map(row).join("")}
<tr class="total"><td>Gesamtkosten Arbeitgeber</td><td class="num">${eur(s.employerCost)}</td></tr></table>
${(s.warnings ?? []).map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}
<p class="foot">Maschinell erstellt (DishData Payroll). Angaben gem. Entgeltbescheinigungsverordnung; Aufbewahrung empfohlen.</p>
<script>window.print();</script>
</body></html>`;
}

/** Open the payslip in a new window and trigger the print dialog. */
export function printPayslip(s: PrintSlip): void {
  const w = window.open("", "_blank", "width=760,height=900");
  if (!w) return;
  w.document.write(buildPayslipHtml(s));
  w.document.close();
}
