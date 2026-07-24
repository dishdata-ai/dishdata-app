-- ============================================================================
-- 0018 · Customer receipts (Kundenbelege / Rechnungen)
-- Generated on-demand from PAID orders — for accounting and for emailing to a
-- guest who asks. Distinct from `supplier_bills` (0007), which are invoices we
-- RECEIVE from vendors (accounts payable). These are what we ISSUE to guests.
--
-- German law requires a gapless, sequential receipt number (fortlaufende
-- Rechnungsnummer). We use the same atomic per-org counter pattern the project
-- already uses for order numbers (next_order_no), so concurrent generation can
-- never produce a duplicate or a gap.
--
-- NOTE: this produces a correct Rechnung/Beleg for accounting + customer use.
-- It is NOT a KassenSichV/TSE-signed fiscal receipt — that requires a certified
-- TSE (e.g. fiskaly cloud) integration, tracked as a separate follow-up.
-- ============================================================================

alter table public.orgs add column if not exists next_receipt_no integer not null default 1;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  receipt_number text not null,
  customer_email text,
  customer_name text,
  status text not null default 'generated', -- 'generated' | 'emailed'
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (org_id, receipt_number),
  unique (order_id) -- one receipt per order (re-generating returns the same one)
);

create index if not exists receipts_org_idx on public.receipts(org_id, created_at desc);

-- updated_at + created_by + RLS, reusing the project's array-driven patterns.
do $$
declare t text := 'receipts';
begin
  execute 'drop trigger if exists set_updated_at on public.receipts';
  execute 'create trigger set_updated_at before update on public.receipts for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists set_created_by on public.receipts';
  execute 'create trigger set_created_by before insert on public.receipts for each row execute function public.set_created_by()';

  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I_member_select on public.%I', t, t);
  execute format('create policy %I_member_select on public.%I for select using (is_org_member(org_id))', t, t);
  execute format('drop policy if exists %I_member_insert on public.%I', t, t);
  execute format('create policy %I_member_insert on public.%I for insert with check (is_org_member(org_id))', t, t);
  execute format('drop policy if exists %I_member_update on public.%I', t, t);
  execute format('create policy %I_member_update on public.%I for update using (is_org_member(org_id))', t, t);
  execute format('drop policy if exists %I_manager_delete on public.%I', t, t);
  execute format('create policy %I_manager_delete on public.%I for delete using (has_org_role(org_id,''owner'',''admin'',''manager''))', t, t);
end $$;

-- Atomically get-or-create the receipt for a paid order. Returns the receipt row
-- as jsonb. Idempotent: calling twice for the same order returns the same
-- receipt (and does NOT burn a new sequential number).
create or replace function public.generate_receipt(_order_id uuid, _email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _status order_status; _no int; _receipt_number text;
  _existing receipts; _cust_name text; _cust_email text; _guest text; _cust_id uuid;
begin
  -- Lock the order row so two concurrent generate calls for the same order
  -- serialize: the second sees the first's committed receipt and returns it
  -- (idempotent) instead of racing the unique(order_id) constraint.
  select org_id, status, guest_name, customer_id into _org, _status, _guest, _cust_id
    from orders where id = _order_id for update;
  if _org is null then raise exception 'order not found'; end if;
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _status <> 'paid' then raise exception 'only paid orders can be receipted'; end if;

  -- Idempotent: return the existing receipt if one already exists.
  select * into _existing from receipts where order_id = _order_id;
  if found then
    return to_jsonb(_existing);
  end if;

  -- Resolve customer name/email (explicit email arg wins, else the order's customer).
  if _cust_id is not null then
    select name, email into _cust_name, _cust_email from customers where id = _cust_id;
  end if;
  _cust_email := coalesce(nullif(trim(coalesce(_email,'')), ''), _cust_email);
  _cust_name := coalesce(_cust_name, _guest);

  -- Atomic gapless sequential number per org. The date is embedded for
  -- readability (RE-YYYYMMDD-NNNN); NNNN is the continuous per-org counter, so
  -- the sequence stays gapless across days/years (not reset daily).
  update orgs set next_receipt_no = next_receipt_no + 1
    where id = _org returning next_receipt_no - 1 into _no;
  _receipt_number := 'RE-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(_no::text, 4, '0');

  insert into receipts (org_id, order_id, receipt_number, customer_email, customer_name, status)
  values (_org, _order_id, _receipt_number, _cust_email, _cust_name, 'generated')
  returning * into _existing;

  return to_jsonb(_existing);
end $$;
