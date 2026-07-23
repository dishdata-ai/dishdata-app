// Client API for the payroll module (pay profiles, runs, payslips).
// All calculation happens client-side in src/lib/payroll/* (pure, deterministic);
// this file only persists inputs and results. RLS: owner/admin only.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { PayslipResult, PayProfileInput, Bundesland, ChurchTax } from "@/lib/payroll/run";
import type { TaxClass } from "@/lib/payroll/lohnsteuer";

export interface PayProfile {
  id: string;
  org_id: string;
  employee_id: string;
  pay_type: "hourly" | "salary";
  monthly_salary: number | null;
  hourly_wage: number | null;
  weekly_hours: number | null;
  employment_start: string | null;
  employment_end: string | null;
  tax_class: TaxClass;
  kinderfreibetraege: number;
  church: ChurchTax;
  bundesland: Bundesland;
  sv_number: string | null;
  birth_date: string | null;
  in_gkv: boolean;
  krankenkasse: string | null;
  kv_zusatzbeitrag: number | null;
  pv_childless: boolean;
  children_under_25: number;
  minijob_rv_exempt: boolean;
  u1_rate: number | null;
  u2_rate: number | null;
  iban: string | null;
  pkv_premium_kv: number | null;
  pkv_premium_pv: number | null;
}

export interface PayrollRun {
  id: string;
  org_id: string;
  period: string; // YYYY-MM-01
  status: "draft" | "finalized";
  params_version: string | null;
  created_at: string;
  finalized_at: string | null;
}

export interface PayslipRow {
  id: string;
  org_id: string;
  run_id: string;
  employee_id: string;
  employment_kind: string;
  hours_worked: number | null;
  gross: number;
  einmalzahlung: number;
  pkv_zuschuss: number;
  lohnsteuer: number;
  soli: number;
  kirchensteuer: number;
  sv_employee: number;
  sv_employer: number;
  netto: number;
  employer_cost: number;
  lines: PayslipResult["lines"];
  warnings: string[];
}

/** Profile row → engine input. */
export function profileToInput(p: PayProfile): PayProfileInput {
  return {
    taxClass: p.tax_class,
    kinderfreibetraege: Number(p.kinderfreibetraege) || 0,
    church: p.church,
    bundesland: p.bundesland,
    inGkv: p.in_gkv,
    krankenkasse: p.krankenkasse,
    kvZusatz: p.kv_zusatzbeitrag != null ? Number(p.kv_zusatzbeitrag) : null,
    pvChildless: p.pv_childless,
    childrenUnder25: p.children_under_25,
    minijobRvExempt: p.minijob_rv_exempt,
    u1Rate: p.u1_rate != null ? Number(p.u1_rate) : null,
    u2Rate: p.u2_rate != null ? Number(p.u2_rate) : null,
    pkvPremiumKv: p.pkv_premium_kv != null ? Number(p.pkv_premium_kv) : null,
    pkvPremiumPv: p.pkv_premium_pv != null ? Number(p.pkv_premium_pv) : null,
  };
}

export async function listPayProfiles(orgId: string): Promise<PayProfile[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("pay_profiles")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as PayProfile[];
}

export async function upsertPayProfile(
  orgId: string,
  employeeId: string,
  fields: Partial<Omit<PayProfile, "id" | "org_id" | "employee_id">>,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await getSupabase()
    .from("pay_profiles")
    .upsert(
      { org_id: orgId, employee_id: employeeId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: "org_id,employee_id" },
    );
  if (error) throw error;
}

export async function listPayrollRuns(orgId: string): Promise<PayrollRun[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("payroll_runs")
    .select("*")
    .eq("org_id", orgId)
    .order("period", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PayrollRun[];
}

export async function listPayslips(orgId: string, runId: string): Promise<PayslipRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("payslips")
    .select("*")
    .eq("org_id", orgId)
    .eq("run_id", runId);
  if (error) throw error;
  return (data ?? []) as PayslipRow[];
}

/** Create/replace the draft run for a period and store the computed payslips. */
export async function saveDraftRun(
  orgId: string,
  period: string, // YYYY-MM-01
  slips: Array<{ employeeId: string; hoursWorked: number | null; result: PayslipResult }>,
): Promise<string> {
  const sb = getSupabase();
  // Never touch a finalized run (the upsert below would silently reopen it).
  const { data: existing } = await sb
    .from("payroll_runs")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("period", period)
    .maybeSingle();
  if (existing?.status === "finalized") {
    throw new Error("Run is finalized — reopen it before recalculating.");
  }
  const { data: run, error: runErr } = await sb
    .from("payroll_runs")
    .upsert(
      { org_id: orgId, period, status: "draft", params_version: slips[0]?.result.paramsVersion ?? null },
      { onConflict: "org_id,period" },
    )
    .select()
    .single();
  if (runErr) throw runErr;

  const { error: delErr } = await sb.from("payslips").delete().eq("run_id", run.id);
  if (delErr) throw delErr;

  const rows = slips.map((s) => ({
    org_id: orgId,
    run_id: run.id,
    employee_id: s.employeeId,
    employment_kind: s.result.employmentKind,
    hours_worked: s.hoursWorked,
    gross: s.result.gross,
    einmalzahlung: s.result.einmalzahlung,
    pkv_zuschuss: s.result.pkvZuschuss,
    lohnsteuer: s.result.tax.lohnsteuer,
    soli: s.result.tax.soli,
    kirchensteuer: s.result.tax.kirchensteuer,
    sv_employee: s.result.sv.totalEmployee,
    sv_employer: s.result.sv.totalEmployer,
    netto: s.result.netto,
    employer_cost: s.result.totalEmployerCost,
    lines: s.result.lines,
    calc_detail: { sv: s.result.sv.detail, sb: s.result.sbDetail },
    warnings: s.result.warnings,
  }));
  if (rows.length) {
    const { error: insErr } = await sb.from("payslips").insert(rows);
    if (insErr) throw insErr;
  }
  return run.id as string;
}

export async function setRunStatus(
  orgId: string,
  runId: string,
  status: "draft" | "finalized",
): Promise<void> {
  const { error } = await getSupabase()
    .from("payroll_runs")
    .update({ status, finalized_at: status === "finalized" ? new Date().toISOString() : null })
    .eq("id", runId)
    .eq("org_id", orgId);
  if (error) throw error;
}
