-- 0014_payroll.sql
-- German payroll (Lohnabrechnung): per-employee pay profiles (Lohnsteuerabzugsmerkmale
-- + SV data), monthly payroll runs, payslips with full line items.
--
-- PRIVACY: payroll data is the most sensitive personal data in the app (DSGVO Art. 9
-- adjacent: church affiliation, children, insurance). RLS restricts ALL access to
-- owner/admin — managers and the employees themselves get no direct table access.
-- ELStAM/DEÜV transmission is not automated yet (needs ERiC / ITSG certification);
-- profile fields mirror what those systems provide/require.

-- ============================================================
-- 1. Pay profiles — one per employee
-- ============================================================
create table if not exists public.pay_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- Employment terms
  pay_type text not null default 'hourly',          -- hourly | salary
  monthly_salary numeric,                            -- when pay_type = salary
  hourly_wage numeric,                               -- when pay_type = hourly (falls back to employees.hourly_rate)
  weekly_hours numeric,
  employment_start date,
  employment_end date,
  -- Lohnsteuerabzugsmerkmale (from ELStAM printout / Bescheinigung)
  tax_class smallint not null default 1 check (tax_class between 1 and 6),
  kinderfreibetraege numeric not null default 0,     -- Zähler: 0 / 0.5 / 1 / 1.5 …
  church text not null default 'none',               -- none | rk | ev
  bundesland text not null default 'Berlin',
  -- Sozialversicherung
  sv_number text,                                    -- Versicherungsnummer
  birth_date date,
  in_gkv boolean not null default true,              -- statutory health insurance
  krankenkasse text,
  kv_zusatzbeitrag numeric,                          -- the Kasse's Zusatzbeitrag, e.g. 0.029
  pv_childless boolean not null default false,       -- ≥23 and no children
  children_under_25 smallint not null default 0,
  minijob_rv_exempt boolean not null default false,  -- Befreiung von der RV-Pflicht (Minijob)
  u1_rate numeric,                                   -- Krankenkasse-specific Umlage rates
  u2_rate numeric,
  -- Payment
  iban text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, employee_id)
);

-- ============================================================
-- 2. Payroll runs — one per org + month
-- ============================================================
create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  period date not null,                              -- first day of the month
  status text not null default 'draft',              -- draft | finalized
  params_version text,
  created_by uuid,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (org_id, period)
);

-- ============================================================
-- 3. Payslips — one per run + employee, full audit trail in jsonb
-- ============================================================
create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  employment_kind text not null,                     -- standard | minijob | midijob
  hours_worked numeric,
  gross numeric not null,
  lohnsteuer numeric not null default 0,
  soli numeric not null default 0,
  kirchensteuer numeric not null default 0,
  sv_employee numeric not null default 0,            -- total employee SV
  sv_employer numeric not null default 0,            -- total employer SV incl. Umlagen + Pauschsteuer
  netto numeric not null,
  employer_cost numeric not null,
  lines jsonb not null default '[]',                 -- [{code,label,amount,side}]
  calc_detail jsonb not null default '{}',           -- annual zvE, VSP, BE midijob … (audit trail)
  warnings jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index if not exists payslips_org_period on public.payslips(org_id, run_id);

-- ============================================================
-- 4. RLS — owner/admin ONLY (payroll privacy)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['pay_profiles','payroll_runs','payslips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_admin_select on public.%I', t, t);
    execute format('create policy %I_admin_select on public.%I for select using (has_org_role(org_id,''owner'',''admin''))', t, t);
    execute format('drop policy if exists %I_admin_insert on public.%I', t, t);
    execute format('create policy %I_admin_insert on public.%I for insert with check (has_org_role(org_id,''owner'',''admin''))', t, t);
    execute format('drop policy if exists %I_admin_update on public.%I', t, t);
    execute format('create policy %I_admin_update on public.%I for update using (has_org_role(org_id,''owner'',''admin''))', t, t);
    execute format('drop policy if exists %I_admin_delete on public.%I', t, t);
    execute format('create policy %I_admin_delete on public.%I for delete using (has_org_role(org_id,''owner'',''admin''))', t, t);
  end loop;
end $$;

-- Finalized runs are immutable: block payslip changes once the run is finalized (GoBD).
create or replace function public.payslips_block_finalized()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.payroll_runs r
    where r.id = coalesce(new.run_id, old.run_id) and r.status = 'finalized'
  ) then
    raise exception 'Payroll run is finalized — payslips are immutable (GoBD). Reopen the run first.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists payslips_immutable on public.payslips;
create trigger payslips_immutable
  before insert or update or delete on public.payslips
  for each row execute function public.payslips_block_finalized();

-- ============================================================
-- 5. Module registration
-- ============================================================
insert into public.modules (id, name, grouping, sort) values ('payroll','Payroll','People',23)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;

-- Owners/admins of existing orgs get access (default_modules_for_role already
-- returns all module ids for owner/admin, so only backfill is needed).
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, 'payroll', true from public.org_members om
where om.role in ('owner','admin')
on conflict (org_id, user_id, module_id) do nothing;
