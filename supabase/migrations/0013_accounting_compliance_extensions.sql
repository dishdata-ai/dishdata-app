-- 0013_accounting_compliance_extensions.sql
-- Persists the extended compliance classification (domestic reverse charge §13b,
-- Bewirtung §4 Abs. 5 Nr. 2 EStG, GWG/asset candidates §6 Abs. 2 EStG) as queryable
-- columns instead of only inside compliance_flags jsonb, so later reports (UStVA
-- §13b lines, GuV Bewirtung add-back, AfA schedule) can filter directly.

alter table public.acct_invoices
  add column if not exists reverse_charge_domestic boolean not null default false,
  add column if not exists is_bewirtung boolean not null default false,
  add column if not exists asset_like boolean not null default false;

create index if not exists acct_invoices_reverse_charge on public.acct_invoices(org_id) where reverse_charge_domestic;
create index if not exists acct_invoices_bewirtung on public.acct_invoices(org_id) where is_bewirtung;
create index if not exists acct_invoices_asset_like on public.acct_invoices(org_id) where asset_like;
