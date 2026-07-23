"use client";

// Payroll — German Lohnabrechnung.
// Tab 1 "Abrechnung": pick a month, gross per employee (salary, or hourly × hours
// pulled from the time clock), full statutory calculation, draft → finalize.
// Tab 2 "Profile": per-employee Lohnsteuerabzugsmerkmale + SV data.
// All calculation is client-side and deterministic: src/lib/payroll/*.

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeEuro, Users, Building2, Landmark, FileText, Lock, LockOpen, Pencil, Printer } from "lucide-react";
import {
  Card, SectionTitle, StatCard, Button, Badge, Modal, Input, Select, Field, Table,
  EmptyState, PageSkeleton,
} from "@/components/ui";
import { useEmployees, useTimeEntries, usePayProfiles, usePayrollRuns, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { toast } from "@/lib/toast";
import {
  listPayslips, saveDraftRun, setRunStatus, upsertPayProfile, profileToInput,
  type PayProfile, type PayslipRow,
} from "@/lib/api/payroll";
import { calcPayslip, BUNDESLAENDER, type PayslipResult } from "@/lib/payroll/run";
import { SUPPORTED_PAYROLL_YEARS } from "@/lib/payroll/params";
import { printPayslip } from "@/lib/payroll/payslip-print";
import { buildLohnsteuerAnmeldung, buildBeitragsnachweise, type SlipForReport } from "@/lib/payroll/reports";
import type { Employee } from "@/lib/api/database.types";

const KIND_LABEL: Record<string, string> = { standard: "SV-pflichtig", minijob: "Minijob", midijob: "Midijob" };
const KIND_TONE: Record<string, "green" | "cyan" | "violet"> = { standard: "green", minijob: "violet", midijob: "cyan" };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/* ------------------------------------------------------------------ */
/* Profile editor                                                      */
/* ------------------------------------------------------------------ */

function ProfileForm({ employee, profile, onDone }: { employee: Employee; profile: PayProfile | null; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [f, setF] = useState({
    pay_type: profile?.pay_type ?? "hourly",
    monthly_salary: profile?.monthly_salary?.toString() ?? "",
    hourly_wage: profile?.hourly_wage?.toString() ?? String(employee.hourly_rate ?? ""),
    weekly_hours: profile?.weekly_hours?.toString() ?? "",
    tax_class: String(profile?.tax_class ?? 1),
    kinderfreibetraege: profile?.kinderfreibetraege?.toString() ?? "0",
    church: profile?.church ?? "none",
    bundesland: profile?.bundesland ?? "Berlin",
    in_gkv: profile ? String(profile.in_gkv) : "true",
    krankenkasse: profile?.krankenkasse ?? "",
    kv_zusatz_pct: profile?.kv_zusatzbeitrag != null ? String(Number(profile.kv_zusatzbeitrag) * 100) : "2.9",
    pv_childless: profile ? String(profile.pv_childless) : "false",
    children_under_25: profile?.children_under_25?.toString() ?? "0",
    minijob_rv_exempt: profile ? String(profile.minijob_rv_exempt) : "false",
    u1_pct: profile?.u1_rate != null ? String(Number(profile.u1_rate) * 100) : "1.6",
    u2_pct: profile?.u2_rate != null ? String(Number(profile.u2_rate) * 100) : "0.44",
    pkv_premium_kv: profile?.pkv_premium_kv?.toString() ?? "",
    pkv_premium_pv: profile?.pkv_premium_pv?.toString() ?? "",
    sv_number: profile?.sv_number ?? "",
    iban: profile?.iban ?? "",
    employment_start: profile?.employment_start ?? "",
    birth_date: profile?.birth_date ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () =>
      upsertPayProfile(org!.id, employee.id, {
        pay_type: f.pay_type as "hourly" | "salary",
        monthly_salary: f.monthly_salary ? +f.monthly_salary : null,
        hourly_wage: f.hourly_wage ? +f.hourly_wage : null,
        weekly_hours: f.weekly_hours ? +f.weekly_hours : null,
        tax_class: +f.tax_class as PayProfile["tax_class"],
        kinderfreibetraege: +f.kinderfreibetraege || 0,
        church: f.church as PayProfile["church"],
        bundesland: f.bundesland as PayProfile["bundesland"],
        in_gkv: f.in_gkv === "true",
        krankenkasse: f.krankenkasse.trim() || null,
        kv_zusatzbeitrag: f.kv_zusatz_pct ? +f.kv_zusatz_pct / 100 : null,
        pv_childless: f.pv_childless === "true",
        children_under_25: +f.children_under_25 || 0,
        minijob_rv_exempt: f.minijob_rv_exempt === "true",
        u1_rate: f.u1_pct ? +f.u1_pct / 100 : null,
        u2_rate: f.u2_pct ? +f.u2_pct / 100 : null,
        pkv_premium_kv: f.pkv_premium_kv ? +f.pkv_premium_kv : null,
        pkv_premium_pv: f.pkv_premium_pv ? +f.pkv_premium_pv : null,
        sv_number: f.sv_number.trim() || null,
        iban: f.iban.trim() || null,
        employment_start: f.employment_start || null,
        birth_date: f.birth_date || null,
      }),
    onSuccess: () => {
      invalidate("pay_profiles");
      toast.success("Profil gespeichert", employee.name);
      onDone();
    },
    onError: (e) => toast.error("Speichern fehlgeschlagen", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Vergütung</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Lohnart">
            <Select value={f.pay_type} onChange={set("pay_type")}>
              <option value="hourly">Stundenlohn</option>
              <option value="salary">Festgehalt</option>
            </Select>
          </Field>
          {f.pay_type === "salary" ? (
            <Field label="Monatsgehalt (brutto)">
              <Input type="number" min="0" step="0.01" value={f.monthly_salary} onChange={set("monthly_salary")} />
            </Field>
          ) : (
            <Field label="Stundenlohn €">
              <Input type="number" min="0" step="0.01" value={f.hourly_wage} onChange={set("hourly_wage")} />
            </Field>
          )}
          <Field label="Wochenstunden">
            <Input type="number" min="0" step="0.5" value={f.weekly_hours} onChange={set("weekly_hours")} placeholder="z.B. 40" />
          </Field>
          <Field label="Eintritt">
            <Input type="date" value={f.employment_start} onChange={set("employment_start")} />
          </Field>
          <Field label="Geburtsdatum">
            <Input type="date" value={f.birth_date} onChange={set("birth_date")} />
          </Field>
          <Field label="IBAN">
            <Input value={f.iban} onChange={set("iban")} placeholder="DE…" />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Lohnsteuer (ELStAM)</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Steuerklasse">
            <Select value={f.tax_class} onChange={set("tax_class")}>
              {[1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Kinderfreibeträge">
            <Input type="number" min="0" step="0.5" value={f.kinderfreibetraege} onChange={set("kinderfreibetraege")} />
          </Field>
          <Field label="Kirchensteuer">
            <Select value={f.church} onChange={set("church")}>
              <option value="none">keine</option>
              <option value="rk">römisch-katholisch</option>
              <option value="ev">evangelisch</option>
            </Select>
          </Field>
          <Field label="Bundesland">
            <Select value={f.bundesland} onChange={set("bundesland")}>
              {BUNDESLAENDER.map((b) => <option key={b}>{b}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Sozialversicherung</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="SV-Nummer">
            <Input value={f.sv_number} onChange={set("sv_number")} />
          </Field>
          <Field label="Gesetzlich versichert">
            <Select value={f.in_gkv} onChange={set("in_gkv")}>
              <option value="true">ja (GKV)</option>
              <option value="false">nein (PKV)</option>
            </Select>
          </Field>
          <Field label="Krankenkasse">
            <Input value={f.krankenkasse} onChange={set("krankenkasse")} placeholder="z.B. TK" />
          </Field>
          <Field label="Zusatzbeitrag %">
            <Input type="number" min="0" step="0.01" value={f.kv_zusatz_pct} onChange={set("kv_zusatz_pct")} />
          </Field>
          <Field label="Kinderlos (PV-Zuschlag)">
            <Select value={f.pv_childless} onChange={set("pv_childless")}>
              <option value="false">nein</option>
              <option value="true">ja (≥ 23 J.)</option>
            </Select>
          </Field>
          <Field label="Kinder unter 25">
            <Input type="number" min="0" step="1" value={f.children_under_25} onChange={set("children_under_25")} />
          </Field>
          <Field label="Minijob: RV-befreit">
            <Select value={f.minijob_rv_exempt} onChange={set("minijob_rv_exempt")}>
              <option value="false">nein</option>
              <option value="true">ja (Befreiung)</option>
            </Select>
          </Field>
          <Field label="U1 / U2 %">
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={f.u1_pct} onChange={set("u1_pct")} />
              <Input type="number" min="0" step="0.01" value={f.u2_pct} onChange={set("u2_pct")} />
            </div>
          </Field>
          {f.in_gkv === "false" && (
            <>
              <Field label="PKV-Prämie KV €/M">
                <Input type="number" min="0" step="0.01" value={f.pkv_premium_kv} onChange={set("pkv_premium_kv")} placeholder="für AG-Zuschuss" />
              </Field>
              <Field label="PKV-Prämie PV €/M">
                <Input type="number" min="0" step="0.01" value={f.pkv_premium_pv} onChange={set("pkv_premium_pv")} />
              </Field>
            </>
          )}
        </div>
      </div>

      <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
        Profil speichern
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Payslip detail                                                      */
/* ------------------------------------------------------------------ */

function PayslipDetail({ slip, name }: { slip: PayslipRow; name: string }) {
  const fmt = useFmt();
  const earnings = slip.lines.filter((l) => l.side === "earning");
  const deductions = slip.lines.filter((l) => l.side === "employee_deduction");
  const employer = slip.lines.filter((l) => l.side === "employer_cost");
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-white">{name}</p>
        <Badge tone={KIND_TONE[slip.employment_kind] ?? "neutral"}>{KIND_LABEL[slip.employment_kind] ?? slip.employment_kind}</Badge>
      </div>
      {(slip.warnings ?? []).map((w, i) => (
        <p key={i} className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">⚠ {w}</p>
      ))}
      <div className="space-y-1">
        {earnings.map((l) => (
          <div key={l.code} className="flex justify-between"><span className="text-zinc-400">{l.label}</span><span className="text-zinc-200">{fmt(l.amount, 2)}</span></div>
        ))}
        {deductions.map((l) => (
          <div key={l.code} className="flex justify-between"><span className="text-zinc-400">{l.label}</span><span className="text-rose-soft">{fmt(l.amount, 2)}</span></div>
        ))}
        <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
          <span className="text-white">Auszahlungsbetrag (netto)</span>
          <span className="text-brand-300">{fmt(slip.netto, 2)}</span>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Arbeitgeberkosten</p>
        <div className="space-y-1">
          {employer.map((l) => (
            <div key={l.code} className="flex justify-between"><span className="text-zinc-500">{l.label}</span><span className="text-zinc-400">{fmt(l.amount, 2)}</span></div>
          ))}
          <div className="flex justify-between border-t border-line pt-2">
            <span className="text-zinc-300">Gesamtkosten Arbeitgeber</span>
            <span className="font-semibold text-zinc-200">{fmt(slip.employer_cost, 2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                           */
/* ------------------------------------------------------------------ */

export default function Payroll() {
  const { org } = useOrg();
  const fmt = useFmt();
  const invalidate = useInvalidate();
  const employeesQ = useEmployees();
  const profilesQ = usePayProfiles();
  const runsQ = usePayrollRuns();
  const timeQ = useTimeEntries();

  const [tab, setTab] = useState<"run" | "profiles">("run");
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [editing, setEditing] = useState<Employee | null>(null);
  const [grossOverride, setGrossOverride] = useState<Record<string, string>>({});
  const [sbInput, setSbInput] = useState<Record<string, string>>({});
  const [slips, setSlips] = useState<PayslipRow[]>([]);
  const [detail, setDetail] = useState<PayslipRow | null>(null);

  const employees = useMemo(() => (employeesQ.data ?? []).filter((e) => e.is_active), [employeesQ.data]);
  const profiles = useMemo(() => {
    const map = new Map<string, PayProfile>();
    for (const p of profilesQ.data ?? []) map.set(p.employee_id, p);
    return map;
  }, [profilesQ.data]);

  const [yearStr, monthStr] = month.split("-");
  const year = +yearStr;
  const monthNum = +monthStr;
  const period = `${month}-01`;
  const run = (runsQ.data ?? []).find((r) => r.period === period) ?? null;
  const yearSupported = SUPPORTED_PAYROLL_YEARS.includes(year);

  // Hours per employee for the selected month (from the time clock).
  const hoursByEmployee = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of timeQ.data ?? []) {
      if (!t.clock_out) continue;
      const d = new Date(t.clock_in);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== monthNum) continue;
      const secs = (new Date(t.clock_out).getTime() - d.getTime()) / 1000 - (t.break_seconds ?? 0);
      map[t.employee_id] = (map[t.employee_id] ?? 0) + Math.max(0, secs) / 3600;
    }
    for (const k of Object.keys(map)) map[k] = Math.round(map[k] * 100) / 100;
    return map;
  }, [timeQ.data, year, monthNum]);

  const grossFor = (e: Employee, p: PayProfile): { gross: number; hours: number | null; wage: number | null } => {
    const override = grossOverride[e.id];
    if (override !== undefined && override !== "") return { gross: +override, hours: null, wage: null };
    if (p.pay_type === "salary" && p.monthly_salary) return { gross: Number(p.monthly_salary), hours: null, wage: null };
    const wage = Number(p.hourly_wage ?? e.hourly_rate) || 0;
    const hours = hoursByEmployee[e.id] ?? 0;
    return { gross: Math.round(wage * hours * 100) / 100, hours, wage };
  };

  // Live calculation for every employee with a profile.
  const computed = useMemo(() => {
    if (!yearSupported) return [];
    const out: Array<{ employee: Employee; profile: PayProfile; gross: number; hours: number | null; result: PayslipResult | null; error: string | null }> = [];
    for (const e of employees) {
      const p = profiles.get(e.id);
      if (!p) continue;
      const { gross, hours, wage } = grossFor(e, p);
      if (gross <= 0) {
        out.push({ employee: e, profile: p, gross, hours, result: null, error: "kein Bruttolohn (keine Stunden erfasst?)" });
        continue;
      }
      try {
        const result = calcPayslip({
          year, month: monthNum, monthlyGross: gross, profile: profileToInput(p),
          hoursWorked: hours, hourlyWage: wage,
          einmalzahlung: +(sbInput[e.id] ?? 0) || 0,
        });
        out.push({ employee: e, profile: p, gross, hours, result, error: null });
      } catch (err) {
        out.push({ employee: e, profile: p, gross, hours, result: null, error: err instanceof Error ? err.message : "Berechnungsfehler" });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, profiles, year, monthNum, hoursByEmployee, grossOverride, sbInput, yearSupported]);

  const totals = useMemo(() => {
    const ok = computed.filter((c) => c.result);
    return {
      count: ok.length,
      gross: ok.reduce((s, c) => s + (c.result?.gross ?? 0) + (c.result?.einmalzahlung ?? 0), 0),
      netto: ok.reduce((s, c) => s + (c.result?.netto ?? 0), 0),
      employer: ok.reduce((s, c) => s + (c.result?.totalEmployerCost ?? 0), 0),
    };
  }, [computed]);

  const saveRun = useMutation({
    mutationFn: async () => {
      const ok = computed.filter((c) => c.result) as Array<{ employee: Employee; hours: number | null; result: PayslipResult }>;
      if (!ok.length) throw new Error("Keine berechenbaren Abrechnungen.");
      return saveDraftRun(org!.id, period, ok.map((c) => ({ employeeId: c.employee.id, hoursWorked: c.hours, result: c.result })));
    },
    onSuccess: async (runId) => {
      invalidate("payroll_runs");
      const rows = await listPayslips(org!.id, runId);
      setSlips(rows);
      toast.success("Entwurf gespeichert", `${computed.filter((c) => c.result).length} Abrechnungen`);
    },
    onError: (e) => toast.error("Speichern fehlgeschlagen", e instanceof Error ? e.message : ""),
  });

  const toggleFinalize = useMutation({
    mutationFn: () => setRunStatus(org!.id, run!.id, run!.status === "finalized" ? "draft" : "finalized"),
    onSuccess: () => {
      invalidate("payroll_runs");
      toast.success(run?.status === "finalized" ? "Lauf wieder geöffnet" : "Lauf festgeschrieben", month);
    },
    onError: (e) => toast.error("Statuswechsel fehlgeschlagen", e instanceof Error ? e.message : ""),
  });

  if (employeesQ.isLoading || profilesQ.isLoading) return <PageSkeleton />;

  const missingProfiles = employees.filter((e) => !profiles.has(e.id));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Payroll"
        subtitle="Lohnabrechnung nach deutschem Recht — Lohnsteuer (§39b), SV-Beiträge, Minijob/Midijob, Umlagen."
        action={
          <div className="flex items-center gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
            {run && (
              <Badge tone={run.status === "finalized" ? "green" : "amber"}>
                {run.status === "finalized" ? "festgeschrieben" : "Entwurf"}
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Mitarbeiter im Lauf" value={String(totals.count)} hint={`${missingProfiles.length} ohne Lohnprofil`} icon={Users} />
        <StatCard title="Bruttolohnsumme" value={fmt(totals.gross, 2)} hint={month} icon={BadgeEuro} />
        <StatCard title="Auszahlung (netto)" value={fmt(totals.netto, 2)} hint="Summe Überweisungen" icon={Landmark} />
        <StatCard title="Arbeitgeberkosten" value={fmt(totals.employer, 2)} hint="brutto + AG-SV + Umlagen" icon={Building2} />
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "run" ? "primary" : "ghost"} onClick={() => setTab("run")}>Abrechnung</Button>
        <Button variant={tab === "profiles" ? "primary" : "ghost"} onClick={() => setTab("profiles")}>
          Lohnprofile {missingProfiles.length > 0 && <Badge tone="amber">{missingProfiles.length} fehlen</Badge>}
        </Button>
      </div>

      {!yearSupported && (
        <Card className="p-4 text-sm text-amber-300">
          Für {year} sind keine geprüften gesetzlichen Parameter hinterlegt (verfügbar: {SUPPORTED_PAYROLL_YEARS.join(", ")}).
        </Card>
      )}

      {tab === "run" && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h3 className="font-semibold text-white">Lohnlauf {month}</h3>
              <p className="text-xs text-zinc-500">Stunden aus der Stempeluhr; Brutto überschreibbar. Berechnung live.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={saveRun.isPending || run?.status === "finalized" || !yearSupported} onClick={() => saveRun.mutate()}>
                <FileText className="h-4 w-4" /> Entwurf speichern
              </Button>
              {run && (
                <Button disabled={toggleFinalize.isPending} onClick={() => toggleFinalize.mutate()}>
                  {run.status === "finalized" ? <><LockOpen className="h-4 w-4" /> Wieder öffnen</> : <><Lock className="h-4 w-4" /> Festschreiben</>}
                </Button>
              )}
            </div>
          </div>
          {computed.length === 0 ? (
            <EmptyState icon={BadgeEuro} title="Keine Abrechnungen" hint="Lege zuerst Lohnprofile für deine Mitarbeiter an." action={<Button onClick={() => setTab("profiles")}>Zu den Profilen</Button>} />
          ) : (
            <Table headers={["Mitarbeiter", "Art", "Stunden", "Brutto", "Einmalzahlung", "LSt+Soli+KiSt", "SV (AN)", "Netto", "AG-Kosten", ""]}>
              {computed.map((c) => (
                <tr key={c.employee.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{c.employee.name}</p>
                    {c.error && <p className="text-xs text-rose-soft">{c.error}</p>}
                    {c.result?.warnings.map((w, i) => <p key={i} className="text-xs text-amber-300">⚠ {w}</p>)}
                  </td>
                  <td className="px-4 py-3">
                    {c.result && <Badge tone={KIND_TONE[c.result.employmentKind]}>{KIND_LABEL[c.result.employmentKind]}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{c.hours != null ? c.hours.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3">
                    <Input
                      type="number" min="0" step="0.01"
                      className="w-28"
                      value={grossOverride[c.employee.id] ?? c.gross.toFixed(2)}
                      onChange={(e) => setGrossOverride((o) => ({ ...o, [c.employee.id]: e.target.value }))}
                      disabled={run?.status === "finalized"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Input
                      type="number" min="0" step="0.01"
                      className="w-24"
                      placeholder="0,00"
                      value={sbInput[c.employee.id] ?? ""}
                      onChange={(e) => setSbInput((o) => ({ ...o, [c.employee.id]: e.target.value }))}
                      disabled={run?.status === "finalized"}
                    />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{c.result ? fmt(c.result.tax.lohnsteuer + c.result.tax.soli + c.result.tax.kirchensteuer, 2) : "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{c.result ? fmt(c.result.sv.totalEmployee, 2) : "—"}</td>
                  <td className="px-4 py-3 font-semibold text-brand-300">{c.result ? fmt(c.result.netto, 2) : "—"}</td>
                  <td className="px-4 py-3 text-zinc-300">{c.result ? fmt(c.result.totalEmployerCost, 2) : "—"}</td>
                  <td className="px-4 py-3">
                    {c.result && (
                      <div className="flex gap-1">
                        <button
                          className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
                          title="Details"
                          onClick={() => {
                            const saved = slips.find((s) => s.employee_id === c.employee.id);
                            setDetail(
                              saved ?? {
                                id: "", org_id: "", run_id: "", employee_id: c.employee.id,
                                employment_kind: c.result!.employmentKind,
                                hours_worked: c.hours, gross: c.result!.gross,
                                einmalzahlung: c.result!.einmalzahlung, pkv_zuschuss: c.result!.pkvZuschuss,
                                lohnsteuer: c.result!.tax.lohnsteuer, soli: c.result!.tax.soli,
                                kirchensteuer: c.result!.tax.kirchensteuer,
                                sv_employee: c.result!.sv.totalEmployee, sv_employer: c.result!.sv.totalEmployer,
                                netto: c.result!.netto, employer_cost: c.result!.totalEmployerCost,
                                lines: c.result!.lines, warnings: c.result!.warnings,
                              },
                            );
                          }}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <button
                          className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white"
                          title="Abrechnung drucken (PDF)"
                          onClick={() =>
                            printPayslip({
                              employeeName: c.employee.name,
                              orgName: org?.name ?? "",
                              period: month,
                              employmentKind: c.result!.employmentKind,
                              taxClass: c.profile.tax_class,
                              krankenkasse: c.profile.krankenkasse,
                              svNumber: c.profile.sv_number,
                              iban: c.profile.iban,
                              gross: c.result!.gross,
                              netto: c.result!.netto,
                              employerCost: c.result!.totalEmployerCost,
                              lines: c.result!.lines,
                              warnings: c.result!.warnings,
                            })
                          }
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "run" && computed.some((c) => c.result) && (() => {
        const reportSlips: SlipForReport[] = computed
          .filter((c) => c.result)
          .map((c) => ({
            employmentKind: c.result!.employmentKind,
            krankenkasse: c.profile.krankenkasse,
            lohnsteuer: c.result!.tax.lohnsteuer,
            soli: c.result!.tax.soli,
            kirchensteuer: c.result!.tax.kirchensteuer,
            lines: c.result!.lines,
          }));
        const lsta = buildLohnsteuerAnmeldung(reportSlips);
        const nachweise = buildBeitragsnachweise(reportSlips);
        return (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="font-semibold text-white">Lohnsteuer-Anmeldung {month}</h3>
              <p className="mb-3 text-xs text-zinc-500">Werte für ELSTER (bis zur ERiC-Anbindung manuell übertragen). Fällig zum 10. des Folgemonats (§41a EStG).</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-zinc-400">Lohnsteuer (Kz 42)</span><span className="text-zinc-200">{fmt(lsta.lohnsteuer, 2)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">Solidaritätszuschlag (Kz 48)</span><span className="text-zinc-200">{fmt(lsta.soli, 2)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">Kirchensteuer</span><span className="text-zinc-200">{fmt(lsta.kirchensteuer, 2)}</span></div>
                <div className="flex justify-between border-t border-line pt-2 font-semibold"><span className="text-white">Abzuführen ans Finanzamt</span><span className="text-brand-300">{fmt(lsta.total, 2)}</span></div>
              </div>
            </Card>
            <Card className="p-4">
              <h3 className="font-semibold text-white">Beitragsnachweise (je Einzugsstelle)</h3>
              <p className="mb-3 text-xs text-zinc-500">AN+AG-Beiträge je Krankenkasse bzw. Minijob-Zentrale — Werte für das SV-Meldeportal. Fällig am drittletzten Bankarbeitstag.</p>
              <div className="space-y-3 text-sm">
                {nachweise.map((n) => (
                  <div key={n.einzugsstelle} className="rounded-lg bg-white/[0.03] p-3">
                    <div className="mb-1 flex justify-between font-medium">
                      <span className="text-white">{n.einzugsstelle}</span>
                      <span className="text-brand-300">{fmt(n.total, 2)}</span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {n.employees} MA · KV {fmt(n.kv, 2)} · RV {fmt(n.rv, 2)} · AV {fmt(n.av, 2)} · PV {fmt(n.pv, 2)}
                      {n.u1 > 0 && <> · U1 {fmt(n.u1, 2)}</>}{n.u2 > 0 && <> · U2 {fmt(n.u2, 2)}</>}
                      {n.insolvenz > 0 && <> · InsO {fmt(n.insolvenz, 2)}</>}
                      {n.pauschsteuer > 0 && <> · PauschSt {fmt(n.pauschsteuer, 2)}</>}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      })()}

      {tab === "profiles" && (
        <Card>
          <div className="border-b border-line p-4">
            <h3 className="font-semibold text-white">Lohnprofile</h3>
            <p className="text-xs text-zinc-500">Steuerklasse, Krankenkasse & SV-Daten je Mitarbeiter — Quelle: ELStAM-Bescheinigung / Mitgliedsbescheinigung der Kasse.</p>
          </div>
          <Table headers={["Mitarbeiter", "Lohnart", "StKl", "Krankenkasse", "Status", ""]}>
            {employees.map((e) => {
              const p = profiles.get(e.id) ?? null;
              return (
                <tr key={e.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-medium text-white">{e.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{p ? (p.pay_type === "salary" ? `Gehalt ${fmt(Number(p.monthly_salary) || 0, 2)}` : `Stundenlohn ${fmt(Number(p.hourly_wage ?? e.hourly_rate) || 0, 2)}`) : "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{p?.tax_class ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{p?.krankenkasse ?? "—"}</td>
                  <td className="px-4 py-3">{p ? <Badge tone="green">vollständig</Badge> : <Badge tone="amber">fehlt</Badge>}</td>
                  <td className="px-4 py-3">
                    <button className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-white" onClick={() => setEditing(e)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Lohnprofil — ${editing?.name ?? ""}`} wide>
        {editing && <ProfileForm employee={editing} profile={profiles.get(editing.id) ?? null} onDone={() => setEditing(null)} />}
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Abrechnung ${month}`}>
        {detail && <PayslipDetail slip={detail} name={employees.find((e) => e.id === detail.employee_id)?.name ?? ""} />}
      </Modal>
    </div>
  );
}
