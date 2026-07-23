// Authority reports derived from a payroll run:
// 1. Lohnsteuer-Anmeldung values (ELSTER; Kz 42 LSt / Kz 48 Soli / KiSt) — §41a EStG.
// 2. Beitragsnachweis per Einzugsstelle (each Krankenkasse; Minijobs → Minijob-Zentrale).
// Until ERiC / ITSG certification these are entered manually in ELSTER / SV-Meldeportal —
// the numbers here are exactly the ones those forms ask for.

import type { PayslipLine } from "./run";

export interface SlipForReport {
  employmentKind: string;
  krankenkasse: string | null;
  lohnsteuer: number;
  soli: number;
  kirchensteuer: number;
  lines: PayslipLine[];
}

const sumCode = (slips: SlipForReport[], code: string) =>
  Math.round(
    slips.reduce((s, slip) => s + Math.abs(slip.lines.find((l) => l.code === code)?.amount ?? 0), 0) * 100,
  ) / 100;

export interface LohnsteuerAnmeldung {
  lohnsteuer: number; // Kennzahl 42
  soli: number; // Kennzahl 48
  kirchensteuer: number; // per-confession Kennzahlen — split manually if mixed
  total: number;
}

export function buildLohnsteuerAnmeldung(slips: SlipForReport[]): LohnsteuerAnmeldung {
  const r = (v: number) => Math.round(v * 100) / 100;
  const lohnsteuer = r(slips.reduce((s, x) => s + Number(x.lohnsteuer), 0));
  const soli = r(slips.reduce((s, x) => s + Number(x.soli), 0));
  const kirchensteuer = r(slips.reduce((s, x) => s + Number(x.kirchensteuer), 0));
  return { lohnsteuer, soli, kirchensteuer, total: r(lohnsteuer + soli + kirchensteuer) };
}

export interface Beitragsnachweis {
  einzugsstelle: string; // Krankenkasse or Minijob-Zentrale
  employees: number;
  kv: number; // AN + AG combined (what the Kasse receives)
  rv: number;
  av: number;
  pv: number;
  u1: number;
  u2: number;
  insolvenz: number;
  pauschsteuer: number; // Minijob-Zentrale only
  total: number;
}

export function buildBeitragsnachweise(slips: SlipForReport[]): Beitragsnachweis[] {
  const groups = new Map<string, SlipForReport[]>();
  for (const s of slips) {
    const key =
      s.employmentKind === "minijob"
        ? "Minijob-Zentrale (Knappschaft-Bahn-See)"
        : s.krankenkasse?.trim() || "(Krankenkasse nicht hinterlegt)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const out: Beitragsnachweis[] = [];
  for (const [einzugsstelle, group] of groups) {
    const kv = sumCode(group, "kv_an") + sumCode(group, "kv_ag");
    const rv = sumCode(group, "rv_an") + sumCode(group, "rv_ag");
    const av = sumCode(group, "av_an") + sumCode(group, "av_ag");
    const pv = sumCode(group, "pv_an") + sumCode(group, "pv_ag");
    const u1 = sumCode(group, "u1");
    const u2 = sumCode(group, "u2");
    const insolvenz = sumCode(group, "inso");
    const pauschsteuer = sumCode(group, "pauschsteuer");
    const r = (v: number) => Math.round(v * 100) / 100;
    out.push({
      einzugsstelle,
      employees: group.length,
      kv: r(kv), rv: r(rv), av: r(av), pv: r(pv),
      u1: r(u1), u2: r(u2), insolvenz: r(insolvenz), pauschsteuer: r(pauschsteuer),
      total: r(kv + rv + av + pv + u1 + u2 + insolvenz + pauschsteuer),
    });
  }
  return out.sort((a, b) => b.total - a.total);
}
