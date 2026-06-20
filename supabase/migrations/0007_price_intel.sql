-- ============================================================================
-- 0007 · Supplier price intelligence
-- Captures per-item, per-vendor prices over time so the app can show whether a
-- price went up or down and which vendor is cheaper. Two capture sources:
--   • 'po'      — auto-recorded when a purchase order is delivered (trigger below)
--   • 'invoice' — extracted from a photographed supplier bill (review → confirm)
--   • 'manual'  — typed in by hand
-- ============================================================================

do $$ begin create type price_source as enum ('manual','po','invoice'); exception when duplicate_object then null; end $$;
do $$ begin create type bill_status as enum ('parsed','reviewed','confirmed'); exception when duplicate_object then null; end $$;

-- A captured supplier bill / invoice (header).
create table if not exists public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text not null default '',
  bill_date date,
  total numeric not null default 0,
  image_url text,
  status bill_status not null default 'parsed',
  raw_extract jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- Line items on a bill (raw_name kept until matched to an inventory item).
create table if not exists public.supplier_bill_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  bill_id uuid not null references public.supplier_bills(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  raw_name text not null,
  qty numeric not null default 1,
  unit text,
  unit_price numeric not null default 0
);

-- The price-history spine: one row per observed (item, vendor, price, time).
-- item/vendor names are denormalised so unmatched (AI-captured) rows stay useful.
create table if not exists public.supplier_item_prices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  item_name text not null default '',
  vendor_name text not null default '',
  price numeric not null default 0,
  unit text,
  pack_qty numeric not null default 1,
  source price_source not null default 'manual',
  bill_item_id uuid references public.supplier_bill_items(id) on delete set null,
  po_item_id uuid references public.purchase_order_items(id) on delete set null,
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists supplier_item_prices_item_idx
  on public.supplier_item_prices(org_id, inventory_item_id, effective_from desc);
create index if not exists supplier_bill_items_bill_idx
  on public.supplier_bill_items(bill_id);

-- updated_at + created_by + RLS, reusing the project's array-driven patterns.
do $$
declare t text;
begin
  execute 'drop trigger if exists set_updated_at on public.supplier_bills';
  execute 'create trigger set_updated_at before update on public.supplier_bills for each row execute function public.set_updated_at()';

  foreach t in array array['supplier_bills','supplier_bill_items','supplier_item_prices'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function public.set_created_by()', t);

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

-- PO delivered → stock in + notification + RECORD PRICES (extends 0001's trigger).
create or replace function public.on_po_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    for r in select * from purchase_order_items where po_id = new.id and inventory_item_id is not null loop
      update inventory_items set stock = stock + r.qty where id = r.inventory_item_id;
      insert into inventory_transactions (org_id, item_id, item_name, delta, reason, note)
      values (new.org_id, r.inventory_item_id, r.name, r.qty, 'purchase', 'PO ' || new.po_number);
      -- price-intelligence: remember what this vendor charged for this item.
      insert into supplier_item_prices
        (org_id, inventory_item_id, vendor_id, item_name, vendor_name, price, unit, pack_qty, source, po_item_id)
      values (
        new.org_id, r.inventory_item_id, new.vendor_id, r.name, new.vendor_name,
        r.unit_cost, (select unit from inventory_items where id = r.inventory_item_id), r.qty, 'po', r.id
      );
    end loop;
    insert into notifications (org_id, type, title, body, ref)
    values (new.org_id, 'po_delivered', 'PO ' || new.po_number || ' delivered',
            'Stock levels updated from ' || new.vendor_name, 'procurement');
  end if;
  return new;
end $$;
