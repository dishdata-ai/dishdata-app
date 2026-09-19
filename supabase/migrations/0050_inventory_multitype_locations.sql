-- ============================================================================
-- 0050 · Inventory multi-type items + storage locations
--
-- setup.sql has carried these columns/tables since the inventory rebuild's
-- Phase 0 work (multi-type items: ingredient/supply/equipment + physical
-- storage locations), but no migration ever shipped it to existing
-- deployments — so a fresh install gets it and a live one doesn't. This is
-- that missing migration, extracted verbatim from setup.sql §4.
--
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.inventory_items add column if not exists item_type text not null default 'ingredient';
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists location_id uuid;
alter table public.inventory_items add column if not exists serial_number text;
alter table public.inventory_items add column if not exists purchase_date date;
alter table public.inventory_items add column if not exists purchase_cost numeric;
alter table public.inventory_items add column if not exists depreciation_months integer;
alter table public.inventory_items add column if not exists asset_status text;

-- Physical storage locations (area + shelf), e.g. 'Dry Store' / 'B3'
create table if not exists public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  area text not null default '',
  shelf text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Maintenance / service history for equipment assets
create table if not exists public.asset_maintenance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete cascade,
  performed_at date not null default current_date,
  kind text not null default 'service',            -- 'service' | 'repair' | 'inspection'
  cost numeric not null default 0,
  note text,
  next_due_at date,
  created_at timestamptz not null default now(),
  created_by uuid
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_location_fk') then
    alter table public.inventory_items
      add constraint inventory_items_location_fk
      foreign key (location_id) references public.storage_locations(id) on delete set null;
  end if;
end $$;

-- RLS: same generic member/manager template every other domain table uses.
do $$
declare t text;
begin
  foreach t in array array['storage_locations','asset_maintenance'] loop
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
