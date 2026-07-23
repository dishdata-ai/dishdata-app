-- 0012_accounting_core.sql
-- German-regulation accounting module: GoBD Beleg vault, extracted invoices with
-- §14/§19/§33-UStDV compliance flags, bank accounts/transactions for reconciliation,
-- SKR03 chart of accounts + double-entry journal. Spec: src/lib/accounting/README.md

-- ============================================================
-- 1. Beleg vault metadata (originals live in the `belege` storage bucket)
-- ============================================================
create table if not exists public.acct_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  storage_path text not null,                  -- belege/<org_id>/<yyyy>/<uuid>.<ext>
  original_filename text not null default '',
  mime_type text not null default 'application/pdf',
  size_bytes bigint not null default 0,
  sha256 text not null default '',             -- GoBD integrity hash of the stored bytes
  source text not null default 'upload',       -- upload | photo | email | pos | bank
  retention_until date,                        -- §147 AO: 10 years from end of year
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. Extracted invoices (one row per Beleg; the compliance engine fills flags/bucket)
-- ============================================================
create table if not exists public.acct_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  document_id uuid references public.acct_documents(id) on delete set null,
  direction text not null default 'purchase',  -- purchase | sale
  vendor_name text not null default '',
  vendor_vat_id text,                          -- USt-IdNr of the supplier
  invoice_no text,
  invoice_date date,
  service_date date,                           -- Leistungsdatum when it differs
  currency text not null default 'EUR',
  vat_lines jsonb not null default '[]',       -- [{rate, net, vat}] per-rate breakdown (7/19/0)
  total_net numeric not null default 0,
  total_vat numeric not null default 0,
  gross numeric not null default 0,
  recipient_status text not null default 'review',  -- ok | none | third_party | review
  recipient_name text,                         -- name printed on the invoice, if any
  delivery_address text,                       -- flagged when it is not the business address
  payment_method text,                         -- card | cash | transfer | direct_debit | unknown
  seller_kleinunternehmer boolean not null default false, -- §19 note on the document
  eu_zero_rated boolean not null default false,            -- steuerfreie IG-Lieferung / reverse charge
  category text not null default 'Other',
  compliance_flags jsonb not null default '[]', -- [{code, severity, message}]
  bucket text not null default 'review',       -- valid | at_risk | blocked | no_vat | review
  status text not null default 'needs_review', -- needs_review | confirmed | excluded
  matched_bank_txn_id uuid,
  notes text,
  extraction_model text,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz
);
create index if not exists acct_invoices_org_date on public.acct_invoices(org_id, invoice_date);
create index if not exists acct_invoices_dedupe on public.acct_invoices(org_id, vendor_name, invoice_no);

-- ============================================================
-- 3. Bank accounts + transactions (reconciliation source)
-- ============================================================
create table if not exists public.acct_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  iban text,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);

create table if not exists public.acct_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  bank_account_id uuid not null references public.acct_bank_accounts(id) on delete cascade,
  booked_on date not null,
  amount numeric not null,                     -- negative = outgoing
  counterparty text,
  counterparty_iban text,
  reference text,
  txn_type text,                               -- card | transfer | direct_debit | fee | internal
  balance_after numeric,
  card_last4 text,
  classification text not null default 'unclassified', -- unclassified | matched | internal | related_party | missing_beleg
  matched_invoice_id uuid references public.acct_invoices(id) on delete set null,
  import_batch text,                           -- dedupe key: filename + row hash
  created_at timestamptz not null default now()
);
create index if not exists acct_bank_txn_org_date on public.acct_bank_transactions(org_id, booked_on);
create unique index if not exists acct_bank_txn_dedupe
  on public.acct_bank_transactions(org_id, bank_account_id, booked_on, amount, coalesce(reference, ''));

-- ============================================================
-- 4. SKR03 chart of accounts + double-entry journal
-- ============================================================
create table if not exists public.acct_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  skr text not null,                           -- SKR03 account number, e.g. '4260'
  name text not null,
  kind text not null default 'expense',        -- asset | liability | equity | revenue | expense | tax
  vat_key text,                                -- DATEV BU-Schlüssel hint (e.g. '9' = 19% VSt)
  unique (org_id, skr)
);

create table if not exists public.acct_journal_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entry_date date not null,
  description text not null default '',
  source text not null default 'manual',       -- manual | invoice | bank | zreport
  source_id uuid,                              -- invoice/bank-txn/z-report id
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.acct_journal_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entry_id uuid not null references public.acct_journal_entries(id) on delete cascade,
  account_id uuid not null references public.acct_accounts(id),
  debit numeric not null default 0,
  credit numeric not null default 0
);
create index if not exists acct_journal_lines_entry on public.acct_journal_lines(entry_id);

-- ============================================================
-- 5. RLS (mirrors 0001 pattern: members read/write, managers delete)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['acct_documents','acct_invoices','acct_bank_accounts',
    'acct_bank_transactions','acct_accounts','acct_journal_entries','acct_journal_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select using (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_insert on public.%I', t, t);
    execute format('create policy %I_member_insert on public.%I for insert with check (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_update on public.%I', t, t);
    execute format('create policy %I_member_update on public.%I for update using (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_manager_delete on public.%I', t, t);
    execute format('create policy %I_manager_delete on public.%I for delete using (has_org_role(org_id,''owner'',''admin'',''manager''))', t, t);
  end loop;
end $$;

-- GoBD: documents are write-once for members — revoke the update policy created above.
drop policy if exists acct_documents_member_update on public.acct_documents;

-- ============================================================
-- 6. Beleg storage bucket (private, write-once for members)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('belege', 'belege', false)
on conflict (id) do nothing;

-- Path convention: <org_id>/<yyyy>/<uuid>.<ext> — first folder segment is the org.
drop policy if exists belege_member_read on storage.objects;
create policy belege_member_read on storage.objects for select
  using (bucket_id = 'belege' and is_org_member(((storage.foldername(name))[1])::uuid));
drop policy if exists belege_member_insert on storage.objects;
create policy belege_member_insert on storage.objects for insert
  with check (bucket_id = 'belege' and is_org_member(((storage.foldername(name))[1])::uuid));
-- No update/delete policies: originals are immutable (GoBD Unveränderbarkeit).

-- ============================================================
-- 7. Seed helper: minimal SKR03 gastro chart, applied per-org on first use.
--    (Function, not rows: orgs are created at runtime.)
-- ============================================================
create or replace function public.acct_seed_skr03(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.acct_accounts (org_id, skr, name, kind, vat_key) values
    (p_org, '1000', 'Kasse', 'asset', null),
    (p_org, '1200', 'Bank', 'asset', null),
    (p_org, '1571', 'Abziehbare Vorsteuer 7%', 'tax', null),
    (p_org, '1576', 'Abziehbare Vorsteuer 19%', 'tax', null),
    (p_org, '1771', 'Umsatzsteuer 7%', 'tax', null),
    (p_org, '1776', 'Umsatzsteuer 19%', 'tax', null),
    (p_org, '3300', 'Wareneingang 7% VSt', 'expense', '8'),
    (p_org, '3400', 'Wareneingang 19% VSt', 'expense', '9'),
    (p_org, '4110', 'Löhne und Gehälter', 'expense', null),
    (p_org, '4210', 'Miete unbewegliche Wirtschaftsgüter', 'expense', null),
    (p_org, '4240', 'Gas, Strom, Wasser', 'expense', '9'),
    (p_org, '4260', 'Instandhaltung betrieblicher Räume', 'expense', '9'),
    (p_org, '4360', 'Versicherungen', 'expense', null),
    (p_org, '4380', 'Beiträge', 'expense', null),
    (p_org, '4650', 'Bewirtungskosten', 'expense', '9'),
    (p_org, '4663', 'Reisekosten Arbeitnehmer Fahrtkosten', 'expense', null),
    (p_org, '4760', 'Verkaufsprovisionen', 'expense', '9'),
    (p_org, '4805', 'Reparatur/Instandhaltung Betriebsausstattung', 'expense', '9'),
    (p_org, '4830', 'Abschreibungen auf Sachanlagen', 'expense', null),
    (p_org, '4855', 'Sofortabschreibung GWG', 'expense', null),
    (p_org, '4910', 'Porto', 'expense', null),
    (p_org, '4930', 'Bürobedarf', 'expense', '9'),
    (p_org, '4950', 'Rechts- und Beratungskosten', 'expense', '9'),
    (p_org, '4970', 'Nebenkosten des Geldverkehrs', 'expense', null),
    (p_org, '4980', 'Sonstiger Betriebsbedarf', 'expense', '9'),
    (p_org, '8300', 'Erlöse 7% USt (außer Haus)', 'revenue', '2'),
    (p_org, '8400', 'Erlöse 19% USt (im Haus)', 'revenue', '3'),
    (p_org, '0400', 'Betriebsausstattung', 'asset', '9'),
    (p_org, '0480', 'Geringwertige Wirtschaftsgüter', 'asset', '9')
  on conflict (org_id, skr) do nothing;
end $$;
