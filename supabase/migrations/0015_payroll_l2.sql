-- 0015_payroll_l2.sql
-- Payroll Phase L2: Einmalzahlungen (sonstige Bezüge) + PKV employer subsidy.

alter table public.pay_profiles
  add column if not exists pkv_premium_kv numeric,   -- monthly PKV health premium (for §257 SGB V subsidy)
  add column if not exists pkv_premium_pv numeric;   -- monthly private Pflege premium

alter table public.payslips
  add column if not exists einmalzahlung numeric not null default 0,
  add column if not exists pkv_zuschuss numeric not null default 0;
