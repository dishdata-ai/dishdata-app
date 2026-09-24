-- ============================================================================
-- DishData — Multi-tenant SaaS schema for Supabase
-- Paste this whole file into the Supabase SQL Editor and run it.
-- The script is idempotent: re-running it is always safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
do $$ begin create type org_role as enum ('owner','admin','partner','manager','staff','accountant','viewer'); exception when duplicate_object then null; end $$;
alter type org_role add value if not exists 'partner'; -- upgrades pre-partner installs
do $$ begin create type order_type as enum ('dine_in','takeaway','delivery'); exception when duplicate_object then null; end $$;
do $$ begin create type order_status as enum ('open','paid','void','refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type kitchen_status as enum ('new','preparing','ready','served'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_method as enum ('card','cash','wallet','stripe'); exception when duplicate_object then null; end $$;
do $$ begin create type po_status as enum ('draft','sent','confirmed','delivered','reconciled'); exception when duplicate_object then null; end $$;
do $$ begin create type inv_reason as enum ('sale','purchase','waste','adjustment','count'); exception when duplicate_object then null; end $$;
do $$ begin create type task_status as enum ('todo','in_progress','done'); exception when duplicate_object then null; end $$;
do $$ begin create type task_priority as enum ('low','medium','high'); exception when duplicate_object then null; end $$;
do $$ begin create type reservation_status as enum ('booked','seated','completed','no_show','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_status as enum ('pending','assigned','picked_up','delivered','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type table_status as enum ('open','seated','reserved','cleaning'); exception when duplicate_object then null; end $$;
do $$ begin create type campaign_status as enum ('draft','scheduled','sent'); exception when duplicate_object then null; end $$;
do $$ begin create type campaign_channel as enum ('email','sms','in_store'); exception when duplicate_object then null; end $$;
do $$ begin create type waste_reason as enum ('spoiled','burnt','returned','overprep','other'); exception when duplicate_object then null; end $$;
do $$ begin create type price_source as enum ('manual','po','invoice'); exception when duplicate_object then null; end $$;
do $$ begin create type bill_status as enum ('parsed','reviewed','confirmed'); exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. CORE TENANCY TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  active_org_id uuid,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  receipt_logo_url text,
  accent_color text,
  currency text not null default 'USD',
  tax_rate numeric not null default 8.5,
  staff_discount_max_pct numeric not null default 0,
  staff_discount_monthly_cap numeric,
  staff_discount_pin_threshold numeric,
  target_food_cost_pct numeric not null default 28,
  onboarding_completed boolean not null default false,
  next_order_no integer not null default 1,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'staff',
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table if not exists public.modules (
  id text primary key,
  name text not null,
  grouping text not null default 'Operate',
  sort integer not null default 0
);

create table if not exists public.member_module_access (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  can_access boolean not null default true,
  primary key (org_id, user_id, module_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  role org_role not null default 'staff',
  code text not null unique default encode(gen_random_bytes(6), 'hex'),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. HELPER FUNCTIONS (SECURITY DEFINER — RLS-safe, no recursion)
-- ----------------------------------------------------------------------------
create or replace function public.is_org_member(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = _org and user_id = auth.uid());
$$;

create or replace function public.has_org_role(_org uuid, variadic _roles org_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = _org and user_id = auth.uid() and role = any(_roles));
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.set_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;

-- Profile auto-creation on signup (NO org/owner assignment — multi-tenant)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Default module grants per role (single source of truth for the DB side;
-- mirror of src/lib/modules.ts)
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  -- compares as ::text so a freshly added enum value ('partner') is usable
  -- within the same transaction that added it
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

create or replace function public.grant_default_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into member_module_access (org_id, user_id, module_id, can_access)
  select new.org_id, new.user_id, m, true
  from unnest(default_modules_for_role(new.role)) as m
  on conflict (org_id, user_id, module_id) do nothing;
  return new;
end $$;

drop trigger if exists on_member_added on public.org_members;
create trigger on_member_added after insert on public.org_members
  for each row execute function public.grant_default_modules();

-- grant_default_modules() only fires when a MEMBER is added. A module added
-- to the app later (channels, till, ...) never backfills to members whose
-- row predates it — this is the mirror-image trigger, firing when a MODULE
-- is added instead, so the two directions are both covered from here on.
create or replace function public.grant_new_module_to_existing_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into member_module_access (org_id, user_id, module_id, can_access)
  select om.org_id, om.user_id, new.id, true
  from org_members om
  where new.id = any(default_modules_for_role(om.role))
  on conflict (org_id, user_id, module_id) do nothing;
  return new;
end $$;

drop trigger if exists on_module_added on public.modules;
create trigger on_module_added after insert on public.modules
  for each row execute function public.grant_new_module_to_existing_members();

-- One-time backfill for the gap the two triggers above don't cover
-- retroactively: existing members, for modules that existed before this
-- migration. No-op on a fresh database (org_members is still empty here).
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, m, true
from public.org_members om, unnest(public.default_modules_for_role(om.role)) as m
on conflict (org_id, user_id, module_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. DOMAIN TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  category text not null default 'General',
  contact_email text,
  contact_phone text,
  rating numeric not null default 4.5,
  on_time_pct numeric not null default 95,
  monthly_spend numeric not null default 0,
  price_index numeric not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  category text not null default 'Dry Goods',
  stock numeric not null default 0,
  unit text not null default 'kg',
  par_level numeric not null default 10,
  unit_cost numeric not null default 0,
  expires_at date,
  vendor_id uuid references public.vendors(id) on delete set null,
  -- Multi-type items + physical location + labeling
  item_type text not null default 'ingredient',   -- 'ingredient' | 'supply' | 'equipment'
  sku text,                                        -- scan/label code (falls back to id)
  location_id uuid,                                -- FK added after storage_locations exists
  -- Equipment-only (null for consumables)
  serial_number text,
  purchase_date date,
  purchase_cost numeric,
  depreciation_months integer,
  asset_status text,                               -- 'in_service' | 'maintenance' | 'retired'
  grams_per_unit numeric,                          -- bridges pc <-> mass for recipe costing, e.g. 1 lemon ≈ 90g
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- Backfill new columns for pre-existing deployments (create table above is a no-op there).
alter table public.inventory_items add column if not exists item_type text not null default 'ingredient';
alter table public.inventory_items add column if not exists sku text;
alter table public.inventory_items add column if not exists location_id uuid;
alter table public.inventory_items add column if not exists serial_number text;
alter table public.inventory_items add column if not exists purchase_date date;
alter table public.inventory_items add column if not exists purchase_cost numeric;
alter table public.inventory_items add column if not exists depreciation_months integer;
alter table public.inventory_items add column if not exists asset_status text;
alter table public.inventory_items add column if not exists grams_per_unit numeric;

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

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  delta numeric not null,
  reason inv_reason not null,
  waste_reason waste_reason,
  ref_order_id uuid,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  category text not null default 'Mains',
  price numeric not null default 0,
  prep_minutes integer not null default 10,
  emoji text not null default '🍽️',
  image_url text,
  description text,
  name_de text,
  description_de text,
  category_de text,
  tax_rate numeric,
  is_active boolean not null default true,
  sold_out_until timestamptz,
  -- Keeps the dish off the public catering catalogue, independently of
  -- is_active (the day-to-day menu) and sold_out_until (tonight).
  hide_from_catering boolean not null default false,
  -- null = regular (no symbol shown on the printed menu or public storefront).
  diet text check (diet in ('veg', 'vegan')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  qty_display text not null default '',
  qty_numeric numeric not null default 0,
  cost numeric not null default 0,
  -- Derived costing (Phase 1): unit null = "same as the stock item" — the
  -- app computes a linked line's cost live from qty * unit_factor * the
  -- stock item's unit_cost / (yield_pct/100); cost above is the fallback
  -- for lines with no stock link. See unit_factor() below.
  unit text,
  yield_pct numeric not null default 100 check (yield_pct > 0 and yield_pct <= 100),
  cost_override numeric
);

-- Backfill for pre-existing deployments (create table above is a no-op there).
alter table public.recipe_ingredients add column if not exists unit text;
alter table public.recipe_ingredients add column if not exists yield_pct numeric not null default 100;
alter table public.recipe_ingredients add column if not exists cost_override numeric;
do $$ begin
  alter table public.recipe_ingredients
    add constraint recipe_ingredients_yield_pct_range check (yield_pct > 0 and yield_pct <= 100);
exception when duplicate_object then null;
end $$;

-- Converts a recipe ingredient's quantity from its own unit into the linked
-- stock item's unit — null "from"/"to" means "same unit" (factor 1), the
-- safety valve that keeps every ingredient line with no unit set behaving
-- exactly as qty_numeric always has. Returns null when the two units can't
-- be reconciled (crossing mass/volume, or a piece conversion with no
-- grams_per_unit) — mirrors src/lib/units.ts::unitFactor(), keep in sync.
create or replace function public.unit_factor(_from text, _to text, _grams_per_unit numeric)
returns numeric language plpgsql immutable as $$
declare _mass constant text[] := array['g','kg'];
declare _vol  constant text[] := array['ml','L'];
declare _mass_to_g jsonb := '{"g":1,"kg":1000}'::jsonb;
declare _vol_to_ml jsonb := '{"ml":1,"L":1000}'::jsonb;
begin
  if _from is null or _to is null or _from = _to then return 1; end if;

  if _from = any(_mass) and _to = any(_mass) then
    return (_mass_to_g->>_from)::numeric / (_mass_to_g->>_to)::numeric;
  end if;
  if _from = any(_vol) and _to = any(_vol) then
    return (_vol_to_ml->>_from)::numeric / (_vol_to_ml->>_to)::numeric;
  end if;

  if _grams_per_unit is null then return null; end if;
  if _from = 'pc' and _to = any(_mass) then
    return _grams_per_unit / (_mass_to_g->>_to)::numeric;
  end if;
  if _to = 'pc' and _from = any(_mass) then
    return (_mass_to_g->>_from)::numeric / _grams_per_unit;
  end if;

  return null; -- e.g. g <-> ml, or pc <-> ml: not reconcilable
end $$;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  po_number text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  vendor_name text not null default '',
  status po_status not null default 'draft',
  expected_at text not null default 'TBD',
  total numeric not null default 0,
  items_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  name text not null,
  qty numeric not null default 1,
  unit_cost numeric not null default 0
);

-- Supplier price intelligence: captured bills + the price-history spine.
-- Mirrors migration 0007_price_intel.sql — keep both in sync.
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

do $$
declare t text;
begin
  execute 'drop trigger if exists set_updated_at on public.supplier_bills';
  execute 'create trigger set_updated_at before update on public.supplier_bills for each row execute function public.set_updated_at()';

  foreach t in array array['supplier_bills','supplier_bill_items','supplier_item_prices'] loop
    if t <> 'supplier_bill_items' then
      execute format('drop trigger if exists set_created_by on public.%I', t);
      execute format('create trigger set_created_by before insert on public.%I for each row execute function public.set_created_by()', t);
    end if;
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

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  seats integer not null default 2,
  zone text not null default 'Main',
  status table_status not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  visits integer not null default 0,
  total_spend numeric not null default 0,
  points integer not null default 0,
  tier text not null default 'Bronze',
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_number text not null,
  order_type order_type not null default 'dine_in',
  table_id uuid references public.restaurant_tables(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  guest_name text,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  tip numeric not null default 0,
  total numeric not null default 0,
  status order_status not null default 'open',
  kitchen_status kitchen_status not null default 'new',
  kitchen_notes text,
  source text not null default 'pos',
  staff_discount_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists orders_org_created_idx on public.orders (org_id, created_at desc);
create index if not exists orders_org_kitchen_idx on public.orders (org_id, kitchen_status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  method payment_method not null default 'card',
  amount numeric not null default 0,
  tip_amount numeric not null default 0,
  split_label text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  table_id uuid references public.restaurant_tables(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  guest_name text not null,
  phone text,
  party_size integer not null default 2,
  starts_at timestamptz not null,
  duration_min integer not null default 90,
  status reservation_status not null default 'booked',
  note text,
  source text not null default 'staff',
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists reservations_org_starts_idx on public.reservations (org_id, starts_at);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  courier_employee_id uuid,
  address text not null default '',
  phone text,
  status delivery_status not null default 'pending',
  eta text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  role_title text not null default 'Server',
  hourly_rate numeric not null default 15,
  pin text,
  shift_note text,
  avatar_hue integer not null default 180,
  is_active boolean not null default true,
  can_approve_discounts boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid
);

-- Staff-discount attribution on orders. Declared here rather than inline in the
-- orders table because employees is defined after orders in this file.
alter table public.orders
  add column if not exists employee_id uuid references public.employees(id) on delete set null,
  add column if not exists staff_discount_employee_id uuid references public.employees(id) on delete set null;
create index if not exists orders_staff_discount_idx
  on public.orders (org_id, staff_discount_employee_id, created_at)
  where staff_discount_employee_id is not null;

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  break_seconds integer not null default 0,
  break_started_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists one_open_entry_per_employee
  on public.time_entries (employee_id) where clock_out is null;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  description text,
  status task_status not null default 'todo',
  priority task_priority not null default 'medium',
  assignee_employee_id uuid references public.employees(id) on delete set null,
  partner_email text,
  is_partner_task boolean not null default false,
  assignee_user_id uuid references auth.users(id) on delete set null,
  effort integer not null default 1,
  category text,
  due_date date,
  position numeric not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  points_delta integer not null,
  reason text not null default '',
  order_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  channel campaign_channel not null default 'email',
  segment jsonb not null default '{}'::jsonb,
  status campaign_status not null default 'draft',
  scheduled_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  date date not null default current_date,
  category text not null default 'Other',
  vendor_name text not null default '',
  amount numeric not null default 0,
  tax_amount numeric not null default 0,
  receipt_url text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid,
  type text not null default 'info',
  title text not null,
  body text,
  ref text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_org_idx on public.notifications (org_id, created_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor uuid,
  table_name text not null,
  action text not null,
  row_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_org_idx on public.audit_log (org_id, created_at desc);

-- updated_at + created_by triggers
do $$
declare t text;
begin
  foreach t in array array['orgs','inventory_items','recipes','purchase_orders','orders','deliveries','tasks','profiles'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['vendors','inventory_items','inventory_transactions','recipes','purchase_orders','orders','payments','reservations','deliveries','employees','tasks','campaigns','expenses','customers'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function public.set_created_by()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','orgs','org_members','modules','member_module_access','invites',
    'vendors','inventory_items','inventory_transactions','storage_locations','asset_maintenance',
    'recipes','recipe_ingredients',
    'purchase_orders','purchase_order_items','restaurant_tables','customers','orders','payments',
    'reservations','deliveries','employees','time_entries','tasks','loyalty_transactions',
    'campaigns','expenses','notifications','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- profiles: self, plus read for co-members of any shared org (Team page)
create or replace function public.shares_org_with(_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members a join org_members b using (org_id)
    where a.user_id = auth.uid() and b.user_id = _user
  );
$$;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_org_read on public.profiles;
create policy profiles_org_read on public.profiles for select using (shares_org_with(id));

-- orgs: members read; owner/admin update
drop policy if exists orgs_member_read on public.orgs;
create policy orgs_member_read on public.orgs for select using (is_org_member(id));
drop policy if exists orgs_admin_update on public.orgs;
create policy orgs_admin_update on public.orgs for update using (has_org_role(id,'owner','admin'));

-- org_members: members read; owner/admin manage
drop policy if exists members_read on public.org_members;
create policy members_read on public.org_members for select using (is_org_member(org_id));
drop policy if exists members_admin_update on public.org_members;
create policy members_admin_update on public.org_members for update using (has_org_role(org_id,'owner','admin'));
drop policy if exists members_admin_delete on public.org_members;
create policy members_admin_delete on public.org_members for delete using (has_org_role(org_id,'owner','admin'));

-- modules: readable by all authenticated
drop policy if exists modules_read on public.modules;
create policy modules_read on public.modules for select to authenticated using (true);

-- member_module_access: members read own org rows; owner/admin manage
drop policy if exists mma_read on public.member_module_access;
create policy mma_read on public.member_module_access for select using (is_org_member(org_id));
drop policy if exists mma_admin_write on public.member_module_access;
create policy mma_admin_write on public.member_module_access for insert with check (has_org_role(org_id,'owner','admin'));
drop policy if exists mma_admin_update on public.member_module_access;
create policy mma_admin_update on public.member_module_access for update using (has_org_role(org_id,'owner','admin'));
drop policy if exists mma_admin_delete on public.member_module_access;
create policy mma_admin_delete on public.member_module_access for delete using (has_org_role(org_id,'owner','admin'));

-- invites: owner/admin only
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites
  for all using (has_org_role(org_id,'owner','admin')) with check (has_org_role(org_id,'owner','admin'));

-- Generic template for domain tables: member select+insert, member update, manager+ delete
do $$
declare t text;
begin
  foreach t in array array['vendors','inventory_items','inventory_transactions','storage_locations',
    'asset_maintenance','recipes','recipe_ingredients',
    'purchase_orders','purchase_order_items','restaurant_tables','customers','orders','payments',
    'reservations','deliveries','employees','time_entries','tasks','loyalty_transactions',
    'campaigns','expenses'] loop
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

-- notifications: members read/update (mark read); inserts come from definer functions
drop policy if exists notif_member_read on public.notifications;
create policy notif_member_read on public.notifications for select using (is_org_member(org_id));
drop policy if exists notif_member_update on public.notifications;
create policy notif_member_update on public.notifications for update using (is_org_member(org_id));

-- audit_log: owner/admin read only
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select using (has_org_role(org_id,'owner','admin'));

-- public storefront reads (anon): active recipes + org branding by slug
drop policy if exists recipes_public_read on public.recipes;
create policy recipes_public_read on public.recipes for select to anon using (is_active = true);
drop policy if exists orgs_public_read on public.orgs;
create policy orgs_public_read on public.orgs for select to anon using (true);

-- RLS is row-level only — the policy above says nothing about columns, so
-- without this an anon key can read every column of every org directly,
-- `settings` included (fiskaly TSE credentials once a restaurant enables
-- TSE). Column privileges are enforced independently of RLS: restrict anon
-- to exactly what the public storefront uses (see PublicMenu["org"] in
-- src/lib/api/public.ts); `authenticated` keeps full column access, gated by
-- orgs_member_read to a member's own org as before.
revoke select on public.orgs from anon;
grant select (id, name, slug, logo_url, accent_color, currency, tax_rate) on public.orgs to anon;

-- ----------------------------------------------------------------------------
-- 6. AUDIT TRIGGER (key tables)
-- ----------------------------------------------------------------------------
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare _org uuid; _row text; _detail jsonb;
begin
  if tg_op = 'DELETE' then
    _org := old.org_id; _row := old.id::text; _detail := to_jsonb(old);
  else
    _org := new.org_id; _row := new.id::text;
    _detail := case when tg_op = 'UPDATE' then jsonb_build_object('new', to_jsonb(new)) else to_jsonb(new) end;
  end if;
  insert into audit_log (org_id, actor, table_name, action, row_id, detail)
  values (_org, auth.uid(), tg_table_name, tg_op, _row, _detail);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['recipes','inventory_items','orders','expenses','employees','member_module_access','purchase_orders'] loop
    execute format('drop trigger if exists audit_changes on public.%I', t);
    execute format('create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.write_audit()', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. NOTIFICATION TRIGGERS
-- ----------------------------------------------------------------------------
create or replace function public.notify_low_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stock < new.par_level * 0.5 and old.stock >= new.par_level * 0.5 then
    insert into notifications (org_id, type, title, body, ref)
    values (new.org_id, 'low_stock', 'Low stock: ' || new.name,
            'Only ' || new.stock || ' ' || new.unit || ' left (par ' || new.par_level || ')', 'inventory');
  end if;
  return new;
end $$;
drop trigger if exists on_low_stock on public.inventory_items;
create trigger on_low_stock after update on public.inventory_items
  for each row execute function public.notify_low_stock();

create or replace function public.notify_order_ready()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kitchen_status = 'ready' and old.kitchen_status is distinct from 'ready' then
    insert into notifications (org_id, type, title, body, ref)
    values (new.org_id, 'order_ready', 'Order ' || new.order_number || ' ready',
            'Kitchen marked the order ready to serve', 'kitchen');
  end if;
  return new;
end $$;
drop trigger if exists on_order_ready on public.orders;
create trigger on_order_ready after update on public.orders
  for each row execute function public.notify_order_ready();

-- PO delivered → stock in + notification + record prices (price intelligence)
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
drop trigger if exists po_delivered on public.purchase_orders;
create trigger po_delivered after update on public.purchase_orders
  for each row execute function public.on_po_delivered();

-- ----------------------------------------------------------------------------
-- 8. BOOTSTRAP RPCs
-- ----------------------------------------------------------------------------
create or replace function public.create_organization(_name text, _currency text default 'USD', _tax_rate numeric default 8.5)
returns uuid language plpgsql security definer set search_path = public as $$
declare _org uuid; _slug text; _n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  _slug := regexp_replace(lower(trim(_name)), '[^a-z0-9]+', '-', 'g');
  _slug := trim(both '-' from _slug);
  if _slug = '' then _slug := 'restaurant'; end if;
  while exists (select 1 from orgs where slug = _slug || case when _n > 0 then '-' || _n else '' end) loop
    _n := _n + 1;
  end loop;
  if _n > 0 then _slug := _slug || '-' || _n; end if;

  insert into orgs (name, slug, currency, tax_rate) values (_name, _slug, _currency, _tax_rate) returning id into _org;
  insert into org_members (org_id, user_id, role) values (_org, auth.uid(), 'owner');

  -- Same auto-link as accept_invite() — a fresh org's owner shouldn't hit
  -- their own "who are you?" picker on My Day either.
  insert into employees (org_id, user_id, name, role_title)
  select _org, auth.uid(), coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Owner'), 'Owner'
  from profiles p where p.id = auth.uid();

  update profiles set active_org_id = _org where id = auth.uid();
  return _org;
end $$;

create or replace function public.accept_invite(_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into _inv from invites where code = _code and accepted_at is null and expires_at > now();
  if not found then raise exception 'Invite is invalid or has expired'; end if;

  insert into org_members (org_id, user_id, role) values (_inv.org_id, auth.uid(), _inv.role)
  on conflict (org_id, user_id) do nothing;

  -- Auto-create + link this member's employee record so My Day works the
  -- moment they join — nothing used to connect an accepted invite to a
  -- Staff-module employee row, so every new joiner landed on a "who are
  -- you?" picker instead of their own page until someone clicked themselves
  -- into existence by hand.
  insert into employees (org_id, user_id, name, role_title)
  select _inv.org_id, auth.uid(),
    coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'New teammate'),
    initcap(_inv.role::text)
  from profiles p
  where p.id = auth.uid()
    and not exists (select 1 from employees e where e.org_id = _inv.org_id and e.user_id = auth.uid());

  update invites set accepted_at = now(), accepted_by = auth.uid() where id = _inv.id;
  update profiles set active_org_id = _inv.org_id where id = auth.uid() and active_org_id is null;
  return _inv.org_id;
end $$;

-- One-time backfill for the gap the fix above doesn't cover retroactively:
-- every existing member who joined before this migration and still has no
-- linked employee row (on a fresh database org_members is empty, so this is
-- a no-op there).
insert into public.employees (org_id, user_id, name, role_title)
select om.org_id, om.user_id,
  coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Team member'),
  initcap(om.role::text)
from public.org_members om
join public.profiles p on p.id = om.user_id
where not exists (
  select 1 from public.employees e where e.org_id = om.org_id and e.user_id = om.user_id
);

-- ----------------------------------------------------------------------------
-- 9. CHECKOUT (the live-data engine) — atomic order + payments + depletion
-- ----------------------------------------------------------------------------
create or replace function public.checkout_order(
  _org uuid,
  _items jsonb,                 -- [{recipe_id, name, qty, price}]
  _order_type order_type default 'dine_in',
  _table_id uuid default null,
  _customer_id uuid default null,
  _kitchen_notes text default null,
  _tip numeric default 0,
  _payments jsonb default '[]'::jsonb,  -- [{method, amount, tip_amount, split_label}]
  _address text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0;
  _tax numeric;
  _total numeric;
  _no int;
  _order_id uuid;
  _order_number text;
  _rate numeric;
  it jsonb;
  pay jsonb;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if jsonb_array_length(_items) = 0 then raise exception 'empty order'; end if;

  select tax_rate into _rate from orgs where id = _org;
  for it in select * from jsonb_array_elements(_items) loop
    _subtotal := _subtotal + (it->>'price')::numeric * (it->>'qty')::numeric;
  end loop;
  _tax := round(_subtotal * _rate / 100, 2);
  _total := round(_subtotal + _tax + coalesce(_tip, 0), 2);

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, table_id, customer_id, items, subtotal, tax, tip, total, status, kitchen_status, kitchen_notes)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items, _subtotal, _tax, coalesce(_tip,0), _total,
          case when jsonb_array_length(_payments) > 0 then 'paid'::order_status else 'open'::order_status end,
          'new', _kitchen_notes)
  returning id into _order_id;

  for pay in select * from jsonb_array_elements(_payments) loop
    insert into payments (org_id, order_id, method, amount, tip_amount, split_label)
    values (_org, _order_id, (pay->>'method')::payment_method, (pay->>'amount')::numeric,
            coalesce((pay->>'tip_amount')::numeric, 0), pay->>'split_label');
  end loop;

  -- Inventory depletion via linked recipe ingredients
  update inventory_items inv
  set stock = greatest(0, inv.stock - usage.used)
  from (
    select ri.inventory_item_id, sum(ri.qty_numeric * (it.value->>'qty')::numeric) as used
    from jsonb_array_elements(_items) it
    join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
    where ri.inventory_item_id is not null and ri.org_id = _org
    group by ri.inventory_item_id
  ) usage
  where inv.id = usage.inventory_item_id;

  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, ref_order_id)
  select _org, ri.inventory_item_id, ri.name, -sum(ri.qty_numeric * (it.value->>'qty')::numeric), 'sale', _order_id
  from jsonb_array_elements(_items) it
  join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
  where ri.inventory_item_id is not null and ri.org_id = _org
  group by ri.inventory_item_id, ri.name;

  -- Loyalty: 1 point per currency unit spent
  if _customer_id is not null then
    update customers set visits = visits + 1, total_spend = total_spend + _total,
      points = points + floor(_total)::int, last_visit_at = now(),
      tier = case
        when total_spend + _total >= 2000 then 'Platinum'
        when total_spend + _total >= 1000 then 'Gold'
        when total_spend + _total >= 400 then 'Silver'
        else 'Bronze' end
    where id = _customer_id and org_id = _org;
    insert into loyalty_transactions (org_id, customer_id, points_delta, reason, order_id)
    values (_org, _customer_id, floor(_total)::int, 'Order ' || _order_number, _order_id);
  end if;

  if _table_id is not null then
    update restaurant_tables set status = 'seated' where id = _table_id and org_id = _org;
  end if;

  if _order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, status)
    values (_org, _order_id, coalesce(_address, ''), 'pending');
  end if;

  return jsonb_build_object('order_id', _order_id, 'order_number', _order_number, 'total', _total);
end $$;

-- Public storefront ordering (anon) — prices computed server-side
create or replace function public.place_public_order(
  _slug text,
  _items jsonb,            -- [{recipe_id, qty}]
  _guest_name text default 'Guest',
  _table_name text default null,
  _notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _rate numeric; _subtotal numeric := 0; _tax numeric; _total numeric;
  _no int; _order_number text; _order_id uuid;
  _full_items jsonb := '[]'::jsonb;
  it jsonb; r record;
begin
  select id, tax_rate into _org, _rate from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if jsonb_array_length(_items) = 0 or jsonb_array_length(_items) > 50 then raise exception 'invalid order'; end if;

  for it in select * from jsonb_array_elements(_items) loop
    select id, name, price into r from recipes
    where id = (it->>'recipe_id')::uuid and org_id = _org and is_active = true;
    if not found then raise exception 'item unavailable'; end if;
    _subtotal := _subtotal + r.price * (it->>'qty')::numeric;
    _full_items := _full_items || jsonb_build_object('recipe_id', r.id, 'name', r.name, 'qty', (it->>'qty')::numeric, 'price', r.price);
  end loop;
  _tax := round(_subtotal * _rate / 100, 2);
  _total := round(_subtotal + _tax, 2);

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, guest_name, items, subtotal, tax, total, status, kitchen_status, kitchen_notes, source)
  values (_org, _order_number, 'dine_in', _guest_name, _full_items, _subtotal, _tax, _total, 'open', 'new',
          coalesce('Table: ' || _table_name || '. ', '') || coalesce(_notes, ''), 'storefront')
  returning id into _order_id;

  insert into notifications (org_id, type, title, body, ref)
  values (_org, 'public_order', 'Online order ' || _order_number,
          _guest_name || coalesce(' at table ' || _table_name, '') || ' — pay at counter', 'kitchen');

  return jsonb_build_object('order_number', _order_number, 'total', _total, 'order_id', _order_id);
end $$;

grant execute on function public.place_public_order to anon;

-- Public reservation booking (anon)
create or replace function public.place_public_reservation(
  _slug text, _guest_name text, _phone text, _party_size int, _starts_at timestamptz, _note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _id uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if _party_size < 1 or _party_size > 30 then raise exception 'invalid party size'; end if;
  if _starts_at < now() then raise exception 'reservation must be in the future'; end if;

  insert into reservations (org_id, guest_name, phone, party_size, starts_at, note, source)
  values (_org, _guest_name, _phone, _party_size, _starts_at, _note, 'public')
  returning id into _id;

  insert into notifications (org_id, type, title, body, ref)
  values (_org, 'reservation', 'New reservation: ' || _guest_name,
          _party_size || ' guests on ' || to_char(_starts_at, 'Mon DD HH24:MI'), 'floor');

  return jsonb_build_object('reservation_id', _id);
end $$;

grant execute on function public.place_public_reservation to anon;

-- ----------------------------------------------------------------------------
-- 10. DEMO SEED DATA (called from onboarding "start with sample data")
-- ----------------------------------------------------------------------------
-- Paste-safe glyph repair (pure ASCII / chr()) -- restores correct emoji etc.
-- for one org's demo data even if this instance's seed literals were corrupted
-- by pasting UTF-8 into the SQL editor. Called at the end of seed_demo_data and
-- by the app after seeding. See migrations/0005_paste_safe_seed.sql.
create or replace function public.repair_demo_encoding(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not has_org_role(_org, 'owner', 'admin') then
    raise exception 'admin only';
  end if;
  update recipes set emoji = chr(128031) where org_id = _org and name = 'Grilled Salmon';
  update recipes set emoji = chr(127834) where org_id = _org and name = 'Truffle Risotto';
  update recipes set emoji = chr(127828) where org_id = _org and name = 'Wagyu Burger';
  update recipes set emoji = chr(127813) where org_id = _org and name = 'Burrata Caprese';
  update recipes set emoji = chr(129425) where org_id = _org and name = 'Crispy Calamari';
  update recipes set emoji = chr(127851) where org_id = _org and name = 'Chocolate Lava Cake';
  update recipes set emoji = chr(127856) where org_id = _org and name = 'Basque Cheesecake';
  update recipes set emoji = chr(127865) where org_id = _org and name = 'Yuzu Spritz';
  update recipes set emoji = chr(9749)   where org_id = _org and name = 'Cold Brew Tonic';
  update recipes set emoji = chr(129472) where org_id = _org and name = 'Chef''s Tasting Board';
  update recipes set emoji = chr(128032) where org_id = _org and name = 'Miso Glazed Cod';
  update recipes set emoji = chr(129367) where org_id = _org and name = 'Caesar Salad';
  update recipe_ingredients set qty_display = '-'
    where org_id = _org and qty_display !~ '^[ -~]*$';
  update employees set shift_note = 'Mon-Fri ' || chr(183) || ' 10:00-19:00' where org_id = _org and name = 'Maria Santos';
  update employees set shift_note = 'Tue-Sat ' || chr(183) || ' 12:00-21:00' where org_id = _org and name = 'James Okafor';
  update employees set shift_note = 'Mon-Fri ' || chr(183) || ' 11:00-20:00' where org_id = _org and name = 'Lena Fischer';
  update employees set shift_note = 'Wed-Sun ' || chr(183) || ' 16:00-24:00' where org_id = _org and name = 'Diego Ruiz';
  update employees set shift_note = 'Thu-Mon ' || chr(183) || ' 16:00-23:00' where org_id = _org and name = 'Aisha Khan';
  update employees set shift_note = 'Wed-Sun ' || chr(183) || ' 17:00-01:00' where org_id = _org and name = 'Tom Nguyen';
  update loyalty_rewards set label = chr(8364) || '5 off',
         description = 'Take ' || chr(8364) || '5 off your next order'
    where org_id = _org and reward_type = 'amount_discount';
end $$;
grant execute on function public.repair_demo_encoding(uuid) to authenticated;

create or replace function public.seed_demo_data(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ocean uuid; v_prime uuid; v_green uuid; v_casa uuid; v_pantry uuid; v_vine uuid;
  i_salmon uuid; i_wagyu uuid; i_rice uuid; i_burrata uuid; i_choc uuid; i_tomato uuid;
  i_romaine uuid; i_cod uuid; i_cream uuid; i_prosecco uuid; i_coldbrew uuid; i_squid uuid;
  l_walkin uuid; l_drystore uuid; l_backoffice uuid;
  i_espresso uuid;
  r_id uuid;
begin
  if not has_org_role(_org, 'owner', 'admin') then raise exception 'admin only'; end if;
  if exists (select 1 from recipes where org_id = _org) then return; end if; -- already seeded

  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'Ocean Direct','Seafood',4.8,96,8420,104) returning id into v_ocean;
  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'Prime Cuts Co','Meat',4.6,92,6150,110) returning id into v_prime;
  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'GreenField Farms','Produce',4.9,98,3870,95) returning id into v_green;
  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'Casa Latteria','Dairy',4.4,88,2940,101) returning id into v_casa;
  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'Pantry Plus','Dry Goods',4.2,94,2210,92) returning id into v_pantry;
  insert into vendors (org_id, name, category, rating, on_time_pct, monthly_spend, price_index) values
    (_org,'Vine & Co','Beverage',4.7,90,4380,99) returning id into v_vine;

  insert into storage_locations (org_id,name,area,shelf,notes) values
    (_org,'Walk-in F1','Walk-in','F1','Fridge — chilled produce & dairy') returning id into l_walkin;
  insert into storage_locations (org_id,name,area,shelf,notes) values
    (_org,'Dry Store B3','Dry Store','B3','Ambient shelving') returning id into l_drystore;
  insert into storage_locations (org_id,name,area,shelf,notes) values
    (_org,'Back Office','Back Office','','Equipment & packaging') returning id into l_backoffice;

  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Salmon fillet','Seafood',14,'kg',20,34,current_date+2,v_ocean) returning id into i_salmon;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Wagyu beef','Meat',8,'kg',12,62,current_date+4,v_prime) returning id into i_wagyu;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Arborio rice','Dry Goods',42,'kg',25,4.2,current_date+180,v_pantry) returning id into i_rice;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Burrata','Dairy',9,'kg',8,18,current_date+3,v_casa) returning id into i_burrata;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Dark chocolate 70%','Dry Goods',11,'kg',10,16,current_date+240,v_pantry) returning id into i_choc;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Heirloom tomatoes','Produce',6,'kg',15,7.5,current_date+3,v_green) returning id into i_tomato;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Romaine lettuce','Produce',18,'kg',12,3.8,current_date+4,v_green) returning id into i_romaine;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Black cod','Seafood',5,'kg',8,41,current_date+2,v_ocean) returning id into i_cod;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Cream cheese','Dairy',16,'kg',10,9.2,current_date+12,v_casa) returning id into i_cream;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Prosecco','Beverage',36,'btl',24,11,current_date+365,v_vine) returning id into i_prosecco;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Cold brew concentrate','Beverage',7,'L',10,8.5,current_date+14,v_vine) returning id into i_coldbrew;
  insert into inventory_items (org_id,name,category,stock,unit,par_level,unit_cost,expires_at,vendor_id) values
    (_org,'Squid','Seafood',10,'kg',10,13,current_date+2,v_ocean) returning id into i_squid;

  -- Tag all seeded ingredients with a storage location (chilled vs ambient)
  update inventory_items set item_type = 'ingredient',
    location_id = case when category in ('Seafood','Meat','Dairy','Produce') then l_walkin else l_drystore end
    where org_id = _org and location_id is null;

  -- Non-food company items: supplies (packaging, stickers) and equipment (machines)
  insert into inventory_items (org_id,name,category,item_type,stock,unit,par_level,unit_cost,location_id,sku) values
    (_org,'Takeaway boxes (large)','Packaging','supply',120,'pc',80,0.45,l_drystore,'PKG-BOX-L'),
    (_org,'Branded stickers (roll)','Packaging','supply',6,'roll',10,12,l_drystore,'PKG-STK-01'),
    (_org,'Napkins (case)','Supplies','supply',14,'case',8,9.5,l_drystore,'SUP-NAP-CS');

  insert into inventory_items
    (org_id,name,category,item_type,stock,unit,unit_cost,location_id,sku,serial_number,purchase_date,purchase_cost,depreciation_months,asset_status)
  values
    (_org,'Espresso Machine','Equipment','equipment',1,'pc',0,l_backoffice,'EQ-ESP-01','LM-2024-8841',current_date-400,6800,60,'in_service')
    returning id into i_espresso;
  insert into inventory_items
    (org_id,name,category,item_type,stock,unit,unit_cost,location_id,sku,serial_number,purchase_date,purchase_cost,depreciation_months,asset_status)
  values
    (_org,'Vacuum Sealer','Equipment','equipment',1,'pc',0,l_backoffice,'EQ-VAC-01','VS-7710',current_date-120,540,36,'in_service'),
    (_org,'Label Printer','Equipment','equipment',1,'pc',0,l_backoffice,'EQ-PRN-01','ZB-410',current_date-60,320,36,'maintenance');

  insert into asset_maintenance (org_id,item_id,performed_at,kind,cost,note,next_due_at) values
    (_org,i_espresso,current_date-30,'service',140,'Descale + group head gasket replaced',current_date+150);

  -- Recipes + ingredient links (qty_numeric = stock units consumed per plate)
  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Grilled Salmon','Mains',28,18,'🐟') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_salmon,'Salmon fillet 200g','1 pc',0.2,6.8),
    (_org,r_id,null,'Asparagus','80g',0,1.1),
    (_org,r_id,null,'Lemon butter','30g',0,0.7),
    (_org,r_id,null,'Herbs & seasoning','10g',0,0.3);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Truffle Risotto','Mains',24,25,'🍚') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_rice,'Arborio rice','120g',0.12,0.9),
    (_org,r_id,null,'Truffle oil','10ml',0,1.8),
    (_org,r_id,null,'Parmesan','40g',0,1.2),
    (_org,r_id,null,'Stock & wine','300ml',0,0.8);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Wagyu Burger','Mains',26,14,'🍔') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_wagyu,'Wagyu patty 180g','1 pc',0.18,5.4),
    (_org,r_id,null,'Brioche bun','1 pc',0,0.9),
    (_org,r_id,null,'Aged cheddar','30g',0,0.8),
    (_org,r_id,null,'Fixings & sauce','—',0,0.9);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Burrata Caprese','Appetizers',16,8,'🍅') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_burrata,'Burrata','125g',0.125,2.9),
    (_org,r_id,i_tomato,'Heirloom tomatoes','150g',0.15,1.4),
    (_org,r_id,null,'Basil & balsamic','—',0,0.5);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Crispy Calamari','Appetizers',14,12,'🦑') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_squid,'Squid','180g',0.18,2.6),
    (_org,r_id,null,'Flour & batter','60g',0,0.3),
    (_org,r_id,null,'Aioli','40g',0,0.5);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Chocolate Lava Cake','Desserts',12,20,'🍫') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_choc,'Dark chocolate','80g',0.08,1.3),
    (_org,r_id,null,'Butter & eggs','—',0,0.8),
    (_org,r_id,null,'Vanilla gelato','1 scoop',0,0.9);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Basque Cheesecake','Desserts',11,10,'🍰') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_cream,'Cream cheese','90g',0.09,1.4),
    (_org,r_id,null,'Cream & eggs','—',0,0.7),
    (_org,r_id,null,'Berry coulis','30g',0,0.5);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Yuzu Spritz','Beverages',13,4,'🍹') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,null,'Yuzu juice','30ml',0,1.1),
    (_org,r_id,i_prosecco,'Prosecco','90ml',0.12,1.3),
    (_org,r_id,null,'Soda & garnish','—',0,0.3);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Cold Brew Tonic','Beverages',8,3,'☕') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_coldbrew,'Cold brew','120ml',0.12,0.7),
    (_org,r_id,null,'Tonic','100ml',0,0.5),
    (_org,r_id,null,'Orange peel','—',0,0.1);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Chef''s Tasting Board','Specials',38,22,'🧀') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,null,'Cured meats','120g',0,4.8),
    (_org,r_id,null,'Artisan cheeses','120g',0,4.2),
    (_org,r_id,null,'Accompaniments','—',0,1.6);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Miso Glazed Cod','Specials',32,20,'🐠') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_cod,'Black cod 180g','1 pc',0.18,7.2),
    (_org,r_id,null,'Miso glaze','40g',0,0.8),
    (_org,r_id,null,'Bok choy & rice','—',0,1.0);

  insert into recipes (org_id,name,category,price,prep_minutes,emoji) values (_org,'Caesar Salad','Appetizers',13,7,'🥗') returning id into r_id;
  insert into recipe_ingredients (org_id,recipe_id,inventory_item_id,name,qty_display,qty_numeric,cost) values
    (_org,r_id,i_romaine,'Romaine','150g',0.15,0.8),
    (_org,r_id,null,'Dressing & anchovy','50g',0,0.9),
    (_org,r_id,null,'Croutons & parmesan','—',0,0.6);

  -- Tables
  insert into restaurant_tables (org_id, name, seats, zone) values
    (_org,'T1',2,'Window'),(_org,'T2',2,'Window'),(_org,'T3',4,'Main'),(_org,'T4',4,'Main'),
    (_org,'T5',4,'Main'),(_org,'T6',6,'Main'),(_org,'T7',6,'Patio'),(_org,'T8',8,'Patio'),
    (_org,'B1',1,'Bar'),(_org,'B2',1,'Bar'),(_org,'B3',1,'Bar');

  -- Employees
  insert into employees (org_id, name, role_title, hourly_rate, shift_note, avatar_hue) values
    (_org,'Maria Santos','Head Chef',38,'Mon–Fri · 10:00–19:00',160),
    (_org,'James Okafor','Sous Chef',28,'Tue–Sat · 12:00–21:00',200),
    (_org,'Lena Fischer','Restaurant Manager',32,'Mon–Fri · 11:00–20:00',260),
    (_org,'Diego Ruiz','Server Lead',19,'Wed–Sun · 16:00–24:00',30),
    (_org,'Aisha Khan','Server',16,'Thu–Mon · 16:00–23:00',320),
    (_org,'Tom Nguyen','Bartender',18,'Wed–Sun · 17:00–01:00',90);

  -- Customers
  insert into customers (org_id, name, email, visits, total_spend, points, tier, last_visit_at) values
    (_org,'Olivia Bennett','olivia.b@email.com',34,2180,4360,'Platinum',now()-interval '2 days'),
    (_org,'Marcus Chen','m.chen@email.com',22,1430,2860,'Gold',now()-interval '5 days'),
    (_org,'Sofia Almeida','sofia.a@email.com',18,990,1980,'Gold',now()-interval '7 days'),
    (_org,'Daniel Wright','d.wright@email.com',11,540,1080,'Silver',now()-interval '3 days'),
    (_org,'Priya Patel','priya.p@email.com',7,310,620,'Silver',now()-interval '14 days'),
    (_org,'Ethan Moore','ethan.m@email.com',3,120,240,'Bronze',now()-interval '30 days');

  -- A couple of purchase orders
  insert into purchase_orders (org_id, po_number, vendor_id, vendor_name, status, expected_at, total, items_count) values
    (_org,'PO-1001',v_ocean,'Ocean Direct','confirmed','Tomorrow',1240,6),
    (_org,'PO-1002',v_green,'GreenField Farms','sent','Thu',480,12),
    (_org,'PO-1003',v_prime,'Prime Cuts Co','draft','TBD',980,4);

  -- Tasks
  insert into tasks (org_id, title, description, status, priority, position) values
    (_org,'Deep-clean walk-in fridge','Monthly deep clean, log temperatures','todo','high',1),
    (_org,'Update allergen chart','New menu items need allergen labels','todo','medium',2),
    (_org,'Train new server on POS','Onboarding for weekend hire','in_progress','medium',1),
    (_org,'Repair patio heater','Partner: facilities contractor','todo','low',3);

  -- ~2 weeks of paid order history (so charts, reports and insights have signal)
  declare
    d int; i int; n int; hour int; placed timestamptz;
    _items jsonb; _subtotal numeric; _tax numeric; _tip numeric; _total numeric;
    _oid uuid; _no int; nlines int; r record;
    methods payment_method[] := array['card','card','card','cash','wallet']::payment_method[];
  begin
    for d in reverse 14..1 loop
      n := case when extract(dow from now() - (d || ' days')::interval) in (5,6) then 16 else 9 end + floor(random()*6)::int;
      for i in 1..n loop
        hour := (array[12,12,13,13,14,18,19,19,20,20,21])[1 + floor(random()*11)::int];
        placed := date_trunc('day', now() - (d || ' days')::interval) + (hour || ' hours')::interval + (floor(random()*60) || ' minutes')::interval;
        _items := '[]'::jsonb; _subtotal := 0;
        nlines := 1 + floor(random()*3)::int;
        for r in (select id, name, price from recipes where org_id = _org order by random() limit nlines) loop
          _items := _items || jsonb_build_object('recipe_id', r.id, 'name', r.name, 'qty', 1, 'price', r.price);
          _subtotal := _subtotal + r.price;
        end loop;
        continue when jsonb_array_length(_items) = 0;
        _tax := round(_subtotal * 0.085, 2);
        _tip := case when random() > 0.5 then round(_subtotal * (0.1 + random()*0.1), 2) else 0 end;
        _total := round(_subtotal + _tax + _tip, 2);
        update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
        insert into orders (org_id, order_number, order_type, items, subtotal, tax, tip, total, status, kitchen_status, source, created_at)
        values (_org, 'ORD-' || lpad(_no::text, 4, '0'),
                case when random() > 0.75 then 'takeaway'::order_type else 'dine_in'::order_type end,
                _items, _subtotal, _tax, _tip, _total, 'paid', 'served', 'pos', placed)
        returning id into _oid;
        insert into payments (org_id, order_id, method, amount, tip_amount, created_at)
        values (_org, _oid, methods[1 + floor(random()*5)::int], _total, _tip, placed);
      end loop;
    end loop;
  end;

  -- Recent expenses
  insert into expenses (org_id, date, category, vendor_name, amount, tax_amount) values
    (_org, current_date - 2, 'Food & Beverage', 'Ocean Direct', 1840, 92),
    (_org, current_date - 3, 'Food & Beverage', 'GreenField Farms', 620, 31),
    (_org, current_date - 5, 'Utilities', 'City Power & Gas', 740, 59.2),
    (_org, current_date - 6, 'Rent', 'Hartley Properties', 5200, 0),
    (_org, current_date - 8, 'Food & Beverage', 'Prime Cuts Co', 1390, 69.5),
    (_org, current_date - 9, 'Marketing', 'SocialBoost Agency', 450, 36),
    (_org, current_date - 11, 'Maintenance', 'FixIt Services', 280, 22.4),
    (_org, current_date - 12, 'Supplies', 'CleanPro Wholesale', 310, 24.8),
    (_org, current_date - 13, 'Food & Beverage', 'Casa Latteria', 540, 27);

  -- Self-heal glyphs in case these seed literals were corrupted on paste.
  perform repair_demo_encoding(_org);
end $$;

-- ----------------------------------------------------------------------------
-- 11. MODULE SEED
-- ----------------------------------------------------------------------------
insert into public.modules (id, name, grouping, sort) values
  ('dashboard','Dashboard','Operate',1),
  ('pos','Point of Sale','Operate',2),
  ('kitchen','Kitchen','Operate',3),
  ('floor','Floor & Reservations','Operate',4),
  ('recipes','Recipes','Operate',5),
  ('inventory','Inventory','Operate',6),
  ('procurement','Procurement','Operate',7),
  ('delivery','Delivery','Operate',8),
  ('sales','Sales','Grow',9),
  ('insights','AI Insights','Grow',10),
  ('menu','Menu Engineering','Grow',11),
  ('crm','Loyalty & CRM','Grow',12),
  ('reports','Reports','Grow',13),
  ('finance','Finance','Money',14),
  ('accounting','Accounting','Money',15),
  ('zreport','Z-Report','Money',16),
  ('myday','My Day','People',16),
  ('staff','Staff','People',17),
  ('timeclock','Time Clock','People',18),
  ('tasks','Tasks','People',19),
  ('team','Team & Access','Admin',20),
  ('audit','Audit Log','Admin',21),
  ('settings','Settings','Admin',22),
  ('channels','Sales Channels','Operate',23)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;

-- ----------------------------------------------------------------------------
-- 12. STORAGE (logos, recipe photos, receipts)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('org-assets','org-assets', true)
on conflict (id) do nothing;

drop policy if exists "org members upload assets" on storage.objects;
create policy "org members upload assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-assets' and public.is_org_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "org members update assets" on storage.objects;
create policy "org members update assets" on storage.objects for update to authenticated
  using (bucket_id = 'org-assets' and public.is_org_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "org members delete assets" on storage.objects;
create policy "org members delete assets" on storage.objects for delete to authenticated
  using (bucket_id = 'org-assets' and public.is_org_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "public read assets" on storage.objects;
create policy "public read assets" on storage.objects for select using (bucket_id = 'org-assets');

-- ----------------------------------------------------------------------------
-- 13. REALTIME
-- ----------------------------------------------------------------------------
do $$ begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.deliveries; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.reservations; exception when duplicate_object then null; end $$;

alter table public.orders replica identity full;
alter table public.tasks replica identity full;
alter table public.deliveries replica identity full;
alter table public.notifications replica identity full;
alter table public.reservations replica identity full;

-- ----------------------------------------------------------------------------
-- 14. PARTNER HUB (mirror of migrations/0023_partner_hub.sql)
-- Partner task space hidden from employees, effort points, skills, kudos.
-- 'partner' comparisons go through role::text so the enum value added above
-- is usable within this same transaction on upgraded installs.
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists is_partner_task boolean not null default false;
alter table public.tasks add column if not exists assignee_user_id uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists effort integer not null default 1;
alter table public.tasks add column if not exists category text;

create or replace function public.can_see_partner_tasks(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = _org and user_id = auth.uid()
      and role::text in ('owner','admin','partner')
  );
$$;

-- Partner-aware task policies (override the generic template from section 5)
drop policy if exists tasks_member_select on public.tasks;
create policy tasks_member_select on public.tasks for select
  using (is_org_member(org_id) and (not is_partner_task or can_see_partner_tasks(org_id)));
drop policy if exists tasks_member_insert on public.tasks;
create policy tasks_member_insert on public.tasks for insert
  with check (is_org_member(org_id) and (not is_partner_task or can_see_partner_tasks(org_id)));
drop policy if exists tasks_member_update on public.tasks;
create policy tasks_member_update on public.tasks for update
  using (is_org_member(org_id) and (not is_partner_task or can_see_partner_tasks(org_id)));
drop policy if exists tasks_manager_delete on public.tasks;
create policy tasks_manager_delete on public.tasks for delete
  using (
    (not is_partner_task and has_org_role(org_id,'owner','admin','manager'))
    or (is_partner_task and can_see_partner_tasks(org_id))
  );

create table if not exists public.partner_profiles (
  id uuid not null default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  skills text[] not null default '{}',
  focus text,
  location text,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

alter table public.partner_profiles enable row level security;
drop policy if exists partner_profiles_select on public.partner_profiles;
create policy partner_profiles_select on public.partner_profiles for select
  using (can_see_partner_tasks(org_id));
drop policy if exists partner_profiles_insert on public.partner_profiles;
create policy partner_profiles_insert on public.partner_profiles for insert
  with check (can_see_partner_tasks(org_id) and (user_id = auth.uid() or has_org_role(org_id,'owner','admin')));
drop policy if exists partner_profiles_update on public.partner_profiles;
create policy partner_profiles_update on public.partner_profiles for update
  using (can_see_partner_tasks(org_id) and (user_id = auth.uid() or has_org_role(org_id,'owner','admin')));
drop policy if exists partner_profiles_delete on public.partner_profiles;
create policy partner_profiles_delete on public.partner_profiles for delete
  using (user_id = auth.uid() or has_org_role(org_id,'owner','admin'));

drop trigger if exists set_updated_at on public.partner_profiles;
create trigger set_updated_at before update on public.partner_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.kudos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  message text not null default '',
  emoji text not null default '👏',
  created_at timestamptz not null default now()
);
create index if not exists kudos_org_idx on public.kudos (org_id, created_at desc);

alter table public.kudos enable row level security;
drop policy if exists kudos_select on public.kudos;
create policy kudos_select on public.kudos for select
  using (can_see_partner_tasks(org_id));
drop policy if exists kudos_insert on public.kudos;
create policy kudos_insert on public.kudos for insert
  with check (can_see_partner_tasks(org_id) and from_user = auth.uid());
drop policy if exists kudos_delete on public.kudos;
create policy kudos_delete on public.kudos for delete
  using (from_user = auth.uid() or has_org_role(org_id,'owner','admin'));

do $$ begin alter publication supabase_realtime add table public.kudos; exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 15. TASK DETAILS (mirror of migrations/0024_task_details.sql)
-- Subtask checklists, attached links, per-task comment threads.
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists links jsonb not null default '[]'::jsonb;

create or replace function public.can_see_task(_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from tasks t
    where t.id = _task
      and is_org_member(t.org_id)
      and (not t.is_partner_task or can_see_partner_tasks(t.org_id))
  );
$$;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

alter table public.task_comments enable row level security;
drop policy if exists task_comments_select on public.task_comments;
create policy task_comments_select on public.task_comments for select
  using (can_see_task(task_id));
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert
  with check (can_see_task(task_id) and author = auth.uid());
drop policy if exists task_comments_update on public.task_comments;
create policy task_comments_update on public.task_comments for update
  using (author = auth.uid());
drop policy if exists task_comments_delete on public.task_comments;
create policy task_comments_delete on public.task_comments for delete
  using (author = auth.uid() or has_org_role(org_id,'owner','admin','manager'));

do $$ begin alter publication supabase_realtime add table public.task_comments; exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 15. SALES CHANNELS (Uber Eats / Wolt / Lieferando, SumUp till) — see 0026, 0043
-- ----------------------------------------------------------------------------
do $$ begin create type channel_provider as enum ('ubereats','wolt','lieferando','sumup');
exception when duplicate_object then null; end $$;
-- Databases created before 0043 lack 'sumup'.
alter type channel_provider add value if not exists 'sumup';

do $$ begin create type channel_order_status as enum ('pending','accepted','rejected','failed');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. Connected channels
-- ----------------------------------------------------------------------------
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider channel_provider not null,
  -- What the platform calls this location (their store/venue/restaurant id).
  external_store_id text not null default '',
  is_active boolean not null default false,
  -- Platform API credentials. Read is restricted to owner/admin (see RLS
  -- below) and the client API layer never selects this column — the Channels
  -- UI writes it and reads only `has_credentials`.
  credentials jsonb not null default '{}'::jsonb,
  -- Our shared secret: the platform signs inbound webhooks with it, and the
  -- ingest route passes it to accept_channel_order() to authorize auto-accept.
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  -- Per-channel customisation -----------------------------------------------
  -- Skip the pending tray and fire straight to the kitchen.
  auto_accept boolean not null default false,
  -- Quoted prep time sent back to the platform on accept.
  prep_minutes integer not null default 20,
  -- Commission the platform takes, for margin reporting (informational).
  commission_pct numeric not null default 30,
  -- Ring platform orders up at a markup vs the dine-in price. Applied when
  -- pushing our menu OUT to the platform, never to inbound order totals —
  -- inbound totals are always what the guest actually paid.
  price_markup_pct numeric not null default 0,
  -- Route these tickets to the kitchen board at all (false = handover only).
  send_to_kitchen boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  -- Reported to the client instead of the secret itself, so the Channels UI
  -- can show "credentials saved" without ever selecting `credentials`.
  has_credentials boolean generated always as (credentials <> '{}'::jsonb) stored,
  -- Health -----------------------------------------------------------------
  last_order_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (org_id, provider)
);

-- ----------------------------------------------------------------------------
-- 2. Inbound orders (the unified inbox)
-- ----------------------------------------------------------------------------
create table if not exists public.channel_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  provider channel_provider not null,
  -- The platform's own id — the idempotency key for their webhook retries.
  external_id text not null,
  -- Short human code the courier/guest quotes (e.g. Wolt's "#4821").
  external_display_id text not null default '',
  status channel_order_status not null default 'pending',
  -- Set once accepted; null while pending/rejected.
  order_id uuid references public.orders(id) on delete set null,
  -- Normalized lines: [{ name, qty, price, recipe_id|null, notes }]. recipe_id
  -- is resolved by name at ingest; unmatched lines still ring up correctly,
  -- they just cannot deplete stock (surfaced as "unmapped" in the UI).
  items jsonb not null default '[]'::jsonb,
  gross numeric not null default 0,
  customer_name text not null default '',
  order_type order_type not null default 'delivery',
  notes text,
  -- Platform courier/pickup info, kept loose since each platform differs.
  fulfillment jsonb not null default '{}'::jsonb,
  -- Untouched original payload, for audit and for replaying a failed parse.
  raw jsonb not null default '{}'::jsonb,
  reject_reason text,
  received_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (org_id, provider, external_id)
);

create index if not exists channel_orders_pending_idx
  on public.channel_orders (org_id, status, received_at desc);
create index if not exists channel_orders_order_idx
  on public.channel_orders (order_id);

-- ----------------------------------------------------------------------------
-- 3. Accept — creates the real order, depletes stock, records the payout
--
-- Authorized either by org membership (staff tapping Accept) or by the
-- channel's own webhook_secret (the ingest route auto-accepting). The secret
-- path exists because a webhook has no auth.uid(); it is not guessable across
-- orgs, so it cannot be used to touch another org's data.
-- ----------------------------------------------------------------------------
-- Per-line VAT; SumUp till sales keep their own time, tip and tender — see 0043.
create or replace function public.accept_channel_order(
  _channel_order uuid,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  co record; ch record; grp record;
  _rate numeric; _is_pos boolean; _at timestamptz; _method payment_method;
  _lines numeric := 0; _gross numeric; _discount numeric := 0; _tip numeric := 0;
  _tax numeric := 0; _subtotal numeric;
  _no int; _order_id uuid; _order_number text; _items jsonb;
begin
  select * into co from channel_orders where id = _channel_order;
  if not found then raise exception 'channel order not found'; end if;
  select * into ch from channels where id = co.channel_id;
  if not found then raise exception 'channel not found'; end if;

  if not (is_org_member(co.org_id) or (_secret is not null and _secret = ch.webhook_secret)) then
    raise exception 'not authorized for this organization';
  end if;

  -- Idempotent: a retry (or a double-tap) returns the order already created.
  if co.status <> 'pending' then
    return jsonb_build_object('order_id', co.order_id, 'already_decided', true, 'status', co.status);
  end if;

  select tax_rate into _rate from orgs where id = co.org_id;

  -- A till sale (SumUp) already happened at the counter, with its own time,
  -- tip and tender. A platform order happens now and is paid out by the
  -- platform (see 0026 on 'wallet').
  _is_pos := co.provider::text = 'sumup';
  _at := case when _is_pos then co.received_at else now() end;
  if _is_pos then
    _tip := greatest(coalesce((co.fulfillment->>'tip')::numeric, 0), 0);
    _method := case when upper(coalesce(co.fulfillment->>'payment_type', '')) = 'CASH'
                    then 'cash'::payment_method else 'card'::payment_method end;
  else
    _method := 'wallet'::payment_method;
  end if;

  -- Lines in the shape POS writes, snapshotting each line's VAT rate: the
  -- channel's own, else the recipe override, else the org default.
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', it.value->>'recipe_id',
           'name', it.value->>'name',
           'qty', (it.value->>'qty')::numeric,
           'price', (it.value->>'price')::numeric,
           'tax_rate', coalesce((it.value->>'tax_rate')::numeric, r.tax_rate, _rate)
         ) order by it.ord), '[]'::jsonb)
    into _items
    from jsonb_array_elements(co.items) with ordinality as it(value, ord)
    left join recipes r on r.id = (it.value->>'recipe_id')::uuid and r.org_id = co.org_id;

  select coalesce(sum((i.value->>'price')::numeric * (i.value->>'qty')::numeric), 0)
    into _lines
    from jsonb_array_elements(_items) i;

  -- Platforms: trust the line prices (what the guest paid), else the payload
  -- total. Till: what was charged is authoritative; lines above it were
  -- discounted at the counter.
  if _is_pos and co.gross > 0 then _gross := co.gross;
  elsif _lines > 0 then _gross := _lines;
  else _gross := co.gross;
  end if;
  _discount := round(greatest(_lines - _gross, 0), 2);

  -- VAT-included pricing, extracted per rate group with any discount spread
  -- proportionally — the same method as checkout_order (0032).
  if _lines > 0 then
    for grp in
      select (i.value->>'tax_rate')::numeric as rate,
             sum((i.value->>'price')::numeric * (i.value->>'qty')::numeric) as gross
      from jsonb_array_elements(_items) i
      group by 1
    loop
      _tax := _tax + round(
        greatest(grp.gross - _discount * grp.gross / _lines, 0) * grp.rate / (100 + grp.rate), 2);
    end loop;
  else
    _tax := round(_gross * _rate / (100 + _rate), 2);
  end if;
  _subtotal := round(_gross - _tax, 2);

  update orgs set next_order_no = next_order_no + 1
    where id = co.org_id returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (
    org_id, order_number, order_type, customer_id, guest_name, items,
    subtotal, tax, tip, total, discount, status, kitchen_status, kitchen_notes, source, created_at
  ) values (
    co.org_id, _order_number, co.order_type, null,
    nullif(co.customer_name, ''), _items,
    _subtotal, _tax, _tip, round(_gross + _tip, 2), _discount,
    'paid',                                    -- the platform / till already collected
    case when ch.send_to_kitchen then 'new'::kitchen_status else 'served'::kitchen_status end,
    co.notes, co.provider::text, _at
  ) returning id into _order_id;

  -- Payment leg so takings/Z-report reconcile.
  insert into payments (org_id, order_id, method, amount, tip_amount, split_label, created_at)
  values (co.org_id, _order_id, _method, round(_gross, 2), _tip, co.provider::text, _at);

  -- Deplete stock for lines we could map to a recipe.
  update inventory_items inv
  set stock = greatest(0, inv.stock - usage.used)
  from (
    select ri.inventory_item_id, sum(ri.qty_numeric * (it.value->>'qty')::numeric) as used
    from jsonb_array_elements(co.items) it
    join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
    where ri.inventory_item_id is not null and ri.org_id = co.org_id
      and it.value->>'recipe_id' is not null
    group by ri.inventory_item_id
  ) usage
  where inv.id = usage.inventory_item_id;

  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, ref_order_id)
  select co.org_id, ri.inventory_item_id, ri.name,
         -sum(ri.qty_numeric * (it.value->>'qty')::numeric), 'sale', _order_id
  from jsonb_array_elements(co.items) it
  join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
  where ri.inventory_item_id is not null and ri.org_id = co.org_id
    and it.value->>'recipe_id' is not null
  group by ri.inventory_item_id, ri.name;

  if co.order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, status)
    values (co.org_id, _order_id,
            coalesce(co.fulfillment->>'address', ''), 'pending');
  end if;

  update channel_orders
  set status = 'accepted', order_id = _order_id, decided_at = now(), decided_by = auth.uid()
  where id = _channel_order;

  update channels
  set last_order_at = greatest(coalesce(last_order_at, _at), _at), last_error = null
  where id = co.channel_id;

  return jsonb_build_object(
    'order_id', _order_id, 'order_number', _order_number,
    'total', round(_gross + _tip, 2), 'already_decided', false
  );
end $$;

-- ----------------------------------------------------------------------------
-- 4. Reject — no order is created; the record stays for reporting.
-- ----------------------------------------------------------------------------
create or replace function public.reject_channel_order(
  _channel_order uuid,
  _reason text default null,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare co record; ch record;
begin
  select * into co from channel_orders where id = _channel_order;
  if not found then raise exception 'channel order not found'; end if;
  select * into ch from channels where id = co.channel_id;

  if not (is_org_member(co.org_id) or (_secret is not null and _secret = ch.webhook_secret)) then
    raise exception 'not authorized for this organization';
  end if;

  if co.status <> 'pending' then
    return jsonb_build_object('already_decided', true, 'status', co.status);
  end if;

  update channel_orders
  set status = 'rejected', reject_reason = _reason,
      decided_at = now(), decided_by = auth.uid()
  where id = _channel_order;

  return jsonb_build_object('already_decided', false, 'status', 'rejected');
end $$;

-- ----------------------------------------------------------------------------
-- 5. Triggers + RLS
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  execute 'drop trigger if exists set_updated_at on public.channels';
  execute 'create trigger set_updated_at before update on public.channels for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists set_created_by on public.channels';
  execute 'create trigger set_created_by before insert on public.channels for each row execute function public.set_created_by()';

  foreach t in array array['channels','channel_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('drop policy if exists %I_member_insert on public.%I', t, t);
    execute format('drop policy if exists %I_member_update on public.%I', t, t);
    execute format('drop policy if exists %I_manager_delete on public.%I', t, t);
  end loop;

  -- channel_orders: any member can see and decide on the inbox.
  execute 'create policy channel_orders_member_select on public.channel_orders for select using (is_org_member(org_id))';
  execute 'create policy channel_orders_member_insert on public.channel_orders for insert with check (is_org_member(org_id))';
  execute 'create policy channel_orders_member_update on public.channel_orders for update using (is_org_member(org_id))';
  execute 'create policy channel_orders_manager_delete on public.channel_orders for delete using (has_org_role(org_id,''owner'',''admin'',''manager''))';

  -- channels holds API credentials → owner/admin only, all verbs.
  execute 'create policy channels_admin_select on public.channels for select using (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_insert on public.channels for insert with check (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_update on public.channels for update using (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_delete on public.channels for delete using (has_org_role(org_id,''owner'',''admin''))';
end $$;

-- ----------------------------------------------------------------------------
-- 6. Register the module (FK from member_module_access requires it first).
--    Grant only to members who already have explicit per-module rows — see
--    0022 for why a lone row would otherwise hide every other module.
-- ----------------------------------------------------------------------------
insert into public.modules (id, name, grouping, sort)
values ('channels', 'Sales Channels', 'Operate', 12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

insert into public.modules (id, name, grouping, sort)
values ('channels', 'Sales Channels', 'Operate', 23)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

do $$ begin alter publication supabase_realtime add table public.channel_orders; exception when duplicate_object then null; end $$;

-- Done. Create a user via the app's signup, then the onboarding wizard calls
-- create_organization() and (optionally) seed_demo_data().

-- ============================================================================
-- 13. EVENT PREORDERS (mirrors 0036_preorders.sql + 0037_preorders_module.sql)
-- Named preorder campaigns (Onam Sadhya, Christmas...) with per-hour dine-in
-- capacity, fed by staff entry, CSV import, or the website form via webhook.
-- ============================================================================

create table if not exists public.preorder_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  service_dates date[] not null default '{}',
  slot_minutes integer not null default 60,
  day_start_hour integer not null default 11,
  day_end_hour integer not null default 22,
  dine_in_capacity integer not null default 20,
  webhook_secret text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.preorder_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id uuid not null references public.preorder_events(id) on delete cascade,
  external_id text,
  customer_name text not null default '',
  customer_email text,
  customer_phone text,
  requested_date date not null,
  quantity integer not null default 1,
  fulfillment_type order_type not null default 'takeaway',
  timeslot_start time,
  timeslot_end time,
  address_street text,
  address_apartment text,
  address_city text,
  address_zip text,
  addon_qty integer not null default 0,
  special_requests text,
  order_total numeric not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists preorder_orders_org_event_idx
  on public.preorder_orders (org_id, event_id);
create index if not exists preorder_orders_event_date_idx
  on public.preorder_orders (event_id, requested_date);
-- Plain, not partial: a plain unique index already lets unlimited manually
-- added orders (external_id null) coexist, since NULL never equals NULL for
-- uniqueness — and a partial index breaks upsert's ON CONFLICT matching
-- (fixed in 0038 after it broke every import in production).
create unique index if not exists preorder_orders_event_external_uidx
  on public.preorder_orders (event_id, external_id);

do $$
declare t text;
begin
  foreach t in array array['preorder_events','preorder_orders'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
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

insert into public.modules (id, name, grouping, sort)
values ('preorders', 'Preorders', 'Operate', 12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- ----------------------------------------------------------------------------
-- 13. TILL & CASH (see migration 0040_till_sessions.sql for the full rationale)
-- ----------------------------------------------------------------------------
do $$ begin
  create type till_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

create table if not exists public.till_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  status till_status not null default 'open',
  opening_float numeric not null default 0,
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  -- All three are snapshots taken at close: `expected` is what the books said,
  -- `counted` is what was physically in the drawer, `difference` is counted
  -- minus expected. Stored rather than recomputed so a later refund or a
  -- backdated correction can never quietly rewrite a closed day's cash book.
  expected_closing numeric,
  counted_closing numeric,
  difference numeric,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists till_sessions_org_opened_idx
  on public.till_sessions (org_id, opened_at desc);

-- At most one open till per restaurant — the whole time-window attribution
-- model depends on sessions never overlapping.
create unique index if not exists till_sessions_one_open_per_org
  on public.till_sessions (org_id) where status = 'open';

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  session_id uuid not null references public.till_sessions(id) on delete cascade,
  direction cash_direction not null,
  -- Always positive; `direction` carries the sign. Storing a signed amount
  -- invites a negative "cash in" that reads as a withdrawal in one report and
  -- a deposit in another.
  amount numeric not null check (amount > 0),
  reason text not null default '',
  comment text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists cash_movements_session_idx
  on public.cash_movements (session_id, created_at);

alter table public.till_sessions enable row level security;
alter table public.cash_movements enable row level security;

drop policy if exists till_sessions_member_read on public.till_sessions;
create policy till_sessions_member_read on public.till_sessions
  for select using (is_org_member(org_id));

drop policy if exists cash_movements_member_read on public.cash_movements;
create policy cash_movements_member_read on public.cash_movements
  for select using (is_org_member(org_id));

-- Writes go exclusively through the definer functions below: opening,
-- closing and recording movements each carry invariants (one open session,
-- expected-balance maths, no reopening a closed session) that a bare INSERT
-- from the client would bypass.

-- ----------------------------------------------------------------------------
-- Cash counted as belonging to a session: the float, plus cash taken while it
-- was open, plus/minus manual movements. Shared by the live balance and by
-- close_till so the number staff watch during service and the number they are
-- reconciled against at close can never be computed two different ways.
-- ----------------------------------------------------------------------------
create or replace function public.till_expected_cash(_session uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.till_sessions;
  _cash_sales numeric;
  _in numeric;
  _out numeric;
begin
  select * into s from till_sessions where id = _session;
  if s.id is null then raise exception 'till session not found'; end if;
  if not is_org_member(s.org_id) then raise exception 'not a member of this organization'; end if;

  -- Voided and refunded orders are excluded rather than subtracted: a refund
  -- is only a status change on the order (no negative payment row exists), so
  -- counting its original cash payment would report money as sitting in a
  -- drawer it has already been handed back out of.
  select coalesce(sum(p.amount + p.tip_amount), 0) into _cash_sales
  from payments p
  join orders o on o.id = p.order_id
  where p.org_id = s.org_id
    and p.method = 'cash'
    and o.status not in ('void', 'refunded')
    and p.created_at >= s.opened_at
    and (s.closed_at is null or p.created_at <= s.closed_at);

  select
    coalesce(sum(amount) filter (where direction = 'in'), 0),
    coalesce(sum(amount) filter (where direction = 'out'), 0)
  into _in, _out
  from cash_movements where session_id = _session;

  return s.opening_float + _cash_sales + _in - _out;
end $$;

create or replace function public.open_till(_org uuid, _opening_float numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _opening_float < 0 then raise exception 'opening float cannot be negative'; end if;
  if exists (select 1 from till_sessions where org_id = _org and status = 'open') then
    raise exception 'a till is already open for this organization';
  end if;

  insert into till_sessions (org_id, opening_float, opened_by)
  values (_org, _opening_float, auth.uid())
  returning id into _id;
  return _id;
end $$;

create or replace function public.record_cash_movement(
  _org uuid,
  _direction text,
  _amount numeric,
  _reason text default '',
  _comment text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _session uuid; _available numeric; _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _amount is null or _amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if _direction not in ('in', 'out') then raise exception 'direction must be in or out'; end if;

  select id into _session from till_sessions where org_id = _org and status = 'open';
  if _session is null then raise exception 'no till is currently open'; end if;

  -- A drawer cannot hand out money it does not hold; letting it go negative
  -- produces a cash book that can never be reconciled against a real count.
  if _direction = 'out' then
    _available := till_expected_cash(_session);
    if _amount > _available then
      raise exception 'cannot take out more than the drawer holds (available %)', _available;
    end if;
  end if;

  insert into cash_movements (org_id, session_id, direction, amount, reason, comment, created_by)
  values (_org, _session, _direction::cash_direction, _amount, coalesce(_reason, ''), _comment, auth.uid())
  returning id into _id;
  return _id;
end $$;

create or replace function public.close_till(
  _org uuid,
  _counted numeric,
  _note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _session uuid; _expected numeric;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _counted is null or _counted < 0 then raise exception 'counted amount cannot be negative'; end if;

  select id into _session from till_sessions where org_id = _org and status = 'open';
  if _session is null then raise exception 'no till is currently open'; end if;

  _expected := till_expected_cash(_session);

  -- A mismatch closes the till and is recorded as the difference. Refusing to
  -- close on a discrepancy would only teach staff to enter the expected
  -- number, which destroys exactly the evidence the cash book exists to keep.
  update till_sessions set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    expected_closing = _expected,
    counted_closing = _counted,
    difference = _counted - _expected,
    note = _note
  where id = _session;

  return _session;
end $$;

grant execute on function public.till_expected_cash(uuid) to authenticated;
grant execute on function public.open_till(uuid, numeric) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.close_till(uuid, numeric, text) to authenticated;

insert into public.modules (id, name, grouping, sort) values
  ('till', 'Till & Cash', 'Money', 15)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;

-- ============================================================================
-- 0042 · Staff availability
--
-- Until now the only record of when someone could work was the free-text
-- `employees.shift_note` ("Wed–Sun · 16:00–24:00") — a standing pattern set by
-- a manager, with no way for staff to say "not next Tuesday". Managers were
-- building the rota from memory and group chats.
--
-- One row per employee per day, entered by the employee themselves for the
-- weeks ahead. No row means "hasn't said" — deliberately distinct from
-- 'unavailable', so the manager can see who still needs chasing rather than
-- assuming silence means free.
--
-- `partial` carries a window. to_time may be earlier than from_time: that is
-- an overnight window (17:00 → 01:00), which is normal for closing shifts.
-- ============================================================================

create table if not exists public.staff_availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  day date not null,
  status text not null check (status in ('available', 'partial', 'unavailable')),
  from_time time,
  to_time time,
  note text,
  updated_at timestamptz not null default now(),
  constraint staff_availability_partial_window
    check (status <> 'partial' or (from_time is not null and to_time is not null)),
  constraint staff_availability_one_per_day unique (employee_id, day)
);

create index if not exists staff_availability_org_day_idx
  on public.staff_availability (org_id, day);

drop trigger if exists set_updated_at on public.staff_availability;
create trigger set_updated_at before update on public.staff_availability
  for each row execute function public.set_updated_at();

-- Staff manage their own days; managers and up can see and correct everyone's
-- (e.g. entering it for someone who told them in person). Coworkers can't see
-- each other's — availability often carries personal reasons in the note.
-- The employee must also belong to the org, so a row can't be filed against
-- another restaurant's employee id.
create or replace function public.can_edit_availability(_org uuid, _employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from employees e where e.id = _employee and e.org_id = _org)
    and (
      has_org_role(_org, 'owner', 'admin', 'manager')
      or exists (select 1 from employees e where e.id = _employee and e.user_id = auth.uid())
    );
$$;

alter table public.staff_availability enable row level security;

drop policy if exists staff_availability_own_or_manager on public.staff_availability;
create policy staff_availability_own_or_manager on public.staff_availability
  for all
  using (can_edit_availability(org_id, employee_id))
  with check (can_edit_availability(org_id, employee_id));

do $$ begin alter publication supabase_realtime add table public.staff_availability; exception when duplicate_object then null; end $$;

-- ============================================================================
-- 0044 · Scheduled shifts + geofenced clock-in
--
-- Shifts: one assigned shift per employee per day, entered by a manager
-- against the availability grid (0042). Same one-row-per-day shape as
-- availability — split shifts aren't supported yet. Readable by the whole
-- org (a rota only helps if everyone can see who else is on); writable by
-- manager and up, same bar as deleting other domain rows.
--
-- Geofenced clock-in: `orgs.clockin_lat/lng/radius_m` are all-or-nothing —
-- null means the feature is off, which is the default for every existing
-- org. When set, My Day checks the browser's geolocation against them
-- before clocking in (enforced client-side; the columns exist mainly so
-- Settings has somewhere to save the pin, and so `time_entries` has a real
-- radius to audit against). The shared Time Clock tablet is never gated —
-- it's already physically at the venue, so the check would be redundant.
--
-- `max_shift_hours` backstops "forgot to clock out": the browser can watch
-- position and auto clock-out someone who has walked off, but only while
-- that tab stays open. The cron job in api/cron/force-clockout closes any
-- entry that has been open longer than this, regardless of location or
-- whether a browser is open anywhere.
-- ============================================================================

alter table public.orgs
  add column if not exists clockin_lat numeric,
  add column if not exists clockin_lng numeric,
  add column if not exists clockin_radius_m integer,
  add column if not exists max_shift_hours numeric not null default 14;

alter table public.time_entries
  add column if not exists clock_in_lat numeric,
  add column if not exists clock_in_lng numeric,
  add column if not exists clock_in_distance_m numeric,
  add column if not exists clock_out_lat numeric,
  add column if not exists clock_out_lng numeric,
  add column if not exists auto_clock_out boolean not null default false;

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  day date not null,
  start_time time not null,
  end_time time not null,
  role_title text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  constraint shifts_one_per_employee_day unique (employee_id, day)
);

create index if not exists shifts_org_day_idx on public.shifts (org_id, day);

drop trigger if exists set_updated_at on public.shifts;
create trigger set_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();
drop trigger if exists set_created_by on public.shifts;
create trigger set_created_by before insert on public.shifts
  for each row execute function public.set_created_by();

alter table public.shifts enable row level security;

drop policy if exists shifts_member_select on public.shifts;
create policy shifts_member_select on public.shifts
  for select using (is_org_member(org_id));

drop policy if exists shifts_manager_write on public.shifts;
create policy shifts_manager_write on public.shifts
  for all
  using (has_org_role(org_id, 'owner', 'admin', 'manager'))
  with check (has_org_role(org_id, 'owner', 'admin', 'manager'));

do $$ begin alter publication supabase_realtime add table public.shifts; exception when duplicate_object then null; end $$;

-- ============================================================================
-- 0047 · Lock down employees and time_entries writes
--
-- Both tables have been sitting on the generic "any org member may
-- select/insert/update" template since day one. That template is fine for
-- things like vendors or inventory; it is wrong here, and has been wrong the
-- whole time:
--
--   - `employees` holds `hourly_rate` and `pin`. Any signed-in member — a
--     part-time server included — could `select * from employees` directly
--     via the API and see every coworker's pay and PIN. The UI hides these
--     columns in a couple of places (Time Clock's canSeeWages), but that was
--     never enforced server-side, so it was cosmetic only.
--   - Worse, the same broad policy let ANY member `update` ANY employee row
--     — hourly_rate, pin, is_active, role_title, not just their own — with
--     nothing checking whose row it was.
--   - `time_entries` had the identical problem: any member could insert or
--     update any employee's clock entries directly, with no server-side
--     invariant stopping them from backdating a clock_in, zeroing out
--     break_seconds, or editing an already-closed shift.
--
-- employees: select narrows to manager+ (who legitimately need the whole
-- roster) plus your own row plus any still-unclaimed row (name/role/avatar
-- only in spirit, but Postgres RLS is row- not column-level — this is the
-- accepted trade-off, see the "Who are you?" picker in MyDay, which needs to
-- see unclaimed rows to work at all). Insert/update narrow to manager+,
-- full stop — self-linking moves to claim_employee() below instead of a
-- direct client update, so it keeps working with no update policy needed
-- for plain members at all.
--
-- time_entries: the SHARED TIME CLOCK TABLET is intentionally allowed to
-- clock any employee in or out from one shared device (see timeclock module
-- defaults) — that is a deliberate feature, not the bug. What was actually
-- wrong is that this happened via bare, unconstrained table writes. Writes
-- now go exclusively through record_clock_in/record_clock_out/
-- record_toggle_break, which carry the same invariants clock_in()/clock_out()
-- always assumed but never enforced (one open entry, can't re-close a closed
-- one, breaks compute from real elapsed time). No insert/update policy is
-- created for time_entries at all — RLS default-denies both, exactly like
-- till_sessions/cash_movements (0040) already do for the same reason. Select
-- is left as org-member-readable: seeing when a coworker clocked in isn't
-- the sensitive part, editing it was.
-- ============================================================================

-- ---- employees --------------------------------------------------------------

drop policy if exists employees_member_select on public.employees;
create policy employees_member_select on public.employees
  for select using (
    is_org_member(org_id)
    and (
      has_org_role(org_id, 'owner', 'admin', 'manager', 'partner')
      or user_id = auth.uid()
      or user_id is null
    )
  );

drop policy if exists employees_member_insert on public.employees;
create policy employees_member_insert on public.employees
  for insert with check (has_org_role(org_id, 'owner', 'admin', 'manager'));

drop policy if exists employees_member_update on public.employees;
create policy employees_member_update on public.employees
  for update using (has_org_role(org_id, 'owner', 'admin', 'manager'));

-- employees_manager_delete already requires owner/admin/manager — untouched.

-- Self-service "this is me" claim, moved server-side so plain members need no
-- update grant on employees at all. Unlinks any previous claim by this user
-- first, then claims the target ONLY if it's still unclaimed — guarded here,
-- not just in the picker UI, so a race between two people clicking the same
-- unclaimed name can never let one steal a profile the other just claimed.
create or replace function public.claim_employee(_org uuid, _employee uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  update employees set user_id = null where org_id = _org and user_id = auth.uid();

  update employees set user_id = auth.uid()
   where id = _employee and org_id = _org and user_id is null;

  if not found then
    raise exception 'That profile is already linked to another account.';
  end if;
end $$;

grant execute on function public.claim_employee(uuid, uuid) to authenticated;

-- ---- time_entries -------------------------------------------------------

drop policy if exists time_entries_member_insert on public.time_entries;
drop policy if exists time_entries_member_update on public.time_entries;
-- No replacement insert/update policy — see header. Select and
-- time_entries_manager_delete are untouched.

create or replace function public.record_clock_in(
  _org uuid,
  _employee uuid,
  _lat numeric default null,
  _lng numeric default null,
  _distance_m numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if not exists (select 1 from employees where id = _employee and org_id = _org) then
    raise exception 'employee not found';
  end if;

  insert into time_entries (org_id, employee_id, clock_in_lat, clock_in_lng, clock_in_distance_m)
  values (_org, _employee, _lat, _lng, _distance_m)
  returning id into _id;
  return _id;
exception when unique_violation then
  raise exception 'Already clocked in';
end $$;

create or replace function public.record_clock_out(
  _org uuid,
  _entry uuid,
  _lat numeric default null,
  _lng numeric default null,
  _auto boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare e public.time_entries;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  select * into e from time_entries where id = _entry and org_id = _org;
  if not found then raise exception 'time entry not found'; end if;
  if e.clock_out is not null then raise exception 'already clocked out'; end if;

  update time_entries set
    clock_out = now(),
    -- Close any still-running break, computed from real elapsed time rather
    -- than trusting a client-supplied duration.
    break_seconds = e.break_seconds + case
      when e.break_started_at is not null
      then greatest(0, extract(epoch from (now() - e.break_started_at))::int)
      else 0
    end,
    break_started_at = null,
    clock_out_lat = coalesce(_lat, clock_out_lat),
    clock_out_lng = coalesce(_lng, clock_out_lng),
    auto_clock_out = auto_clock_out or _auto
  where id = _entry;
end $$;

create or replace function public.record_toggle_break(_org uuid, _entry uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.time_entries;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  select * into e from time_entries where id = _entry and org_id = _org;
  if not found then raise exception 'time entry not found'; end if;
  if e.clock_out is not null then raise exception 'already clocked out'; end if;

  if e.break_started_at is not null then
    update time_entries set
      break_seconds = e.break_seconds + greatest(0, extract(epoch from (now() - e.break_started_at))::int),
      break_started_at = null
    where id = _entry;
  else
    update time_entries set break_started_at = now() where id = _entry;
  end if;
end $$;

grant execute on function public.record_clock_in(uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.record_clock_out(uuid, uuid, numeric, numeric, boolean) to authenticated;
grant execute on function public.record_toggle_break(uuid, uuid) to authenticated;

-- ============================================================================
-- 0048 · Staff meal/drink allowance
--
-- A daily € budget staff can spend on food and drinks during their shift,
-- self-served at the till with their own PIN — no manager needed for the
-- common case. Modeled directly on 0033's staff discount (same shape: an
-- org-level limit, per-order attribution, usage computed on demand rather
-- than a stored running counter) but it is its own separate budget:
--
--   orgs.staff_meal_daily_limit   € comped per employee per calendar day
--                                 (null/0 = feature off, the default)
--   orders.staff_meal_amount     how much of THIS order was the free
--                                 allowance (as opposed to a discretionary
--                                 staff_discount_amount) — kept apart so the
--                                 two budgets never mix in reporting or in
--                                 the existing monthly discount cap
--
-- Taking more than the daily allowance is allowed, not blocked — ordering
-- extra, or a parcel to take home, just spends past the free amount and the
-- rest is automatically charged at the org's staff-discount rate
-- (org.staff_discount_max_pct; full price if that's not configured). There
-- is no separate manager-PIN-over-threshold gate on the meal path the way
-- there is on the discretionary discount — the daily cap is the control.
--
-- Identity is verified with the EMPLOYEE'S OWN pin (checkout_order's new
-- _meal_pin param), not the can_approve_discounts manager PIN from 0033 —
-- different question ("is this really you?" vs "who's allowed to approve a
-- large discount?"). Passing _meal_pin is what selects this whole code path;
-- calling checkout_order with _staff_employee_id set and _meal_pin left null
-- keeps 0033's existing "give a friend a discount" behavior byte-for-byte.
--
-- Inventory depletion for a meal-claim order is tagged reason='staff_meal'
-- instead of 'sale', so where the stock actually went is a real, separate
-- line in the inventory ledger rather than folded into revenue-driving sales.
-- ============================================================================

alter table public.orgs
  add column if not exists staff_meal_daily_limit numeric;

alter table public.orders
  add column if not exists staff_meal_amount numeric not null default 0;

do $$ begin alter type inv_reason add value if not exists 'staff_meal'; exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Today's allowance for one employee. The POS calls this to show "€3.20 of
-- €8 left today" before anyone claims a meal.
-- ----------------------------------------------------------------------------
create or replace function public.staff_meal_usage(_org uuid, _employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _used numeric := 0; _limit numeric; _count int := 0;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  select staff_meal_daily_limit into _limit from orgs where id = _org;

  select coalesce(sum(o.staff_meal_amount), 0), count(*)
    into _used, _count
    from orders o
   where o.org_id = _org
     and o.staff_discount_employee_id = _employee
     and o.staff_meal_amount > 0
     and o.status not in ('void', 'refunded')
     and o.created_at >= date_trunc('day', now());

  return jsonb_build_object(
    'used', _used,
    'orders', _count,
    'limit', _limit,
    'remaining', case when coalesce(_limit, 0) <= 0 then 0 else greatest(_limit - _used, 0) end
  );
end $$;

-- ----------------------------------------------------------------------------
-- Per-employee staff-meal totals over a date range, for the Staff page —
-- mirrors staff_discount_report (0033).
-- ----------------------------------------------------------------------------
create or replace function public.staff_meal_report(
  _org uuid,
  _from timestamptz default null,
  _to timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _rows jsonb;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'employee_id', employee_id,
               'employee_name', employee_name,
               'role_title', role_title,
               'orders', order_count,
               'meal_amount', meal_amount,
               'discounted_amount', discounted_amount,
               'revenue', revenue
             ) order by meal_amount desc
           ),
           '[]'::jsonb
         ) into _rows
  from (
    select e.id             as employee_id,
           e.name           as employee_name,
           e.role_title     as role_title,
           count(o.id)      as order_count,
           round(sum(o.staff_meal_amount), 2)     as meal_amount,
           round(sum(o.staff_discount_amount), 2) as discounted_amount,
           round(sum(o.total), 2)                 as revenue
      from orders o
      join employees e on e.id = o.staff_discount_employee_id
     where o.org_id = _org
       and o.staff_meal_amount > 0
       and o.status not in ('void', 'refunded')
       and (_from is null or o.created_at >= _from)
       and (_to   is null or o.created_at <  _to)
     group by e.id, e.name, e.role_title
  ) grouped;

  return _rows;
end $$;

-- ----------------------------------------------------------------------------
-- checkout_order — body from 0033, plus the staff meal branch. Gains one
-- trailing param (_meal_pin), so the 15-arg version is dropped first.
-- ----------------------------------------------------------------------------
drop function if exists public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text);

create or replace function public.checkout_order(
  _org uuid,
  _items jsonb,
  _order_type order_type default 'dine_in',
  _table_id uuid default null,
  _customer_id uuid default null,
  _kitchen_notes text default null,
  _tip numeric default 0,
  _payments jsonb default '[]'::jsonb,
  _address text default null,
  _redemption_code text default null,
  _discount_amount numeric default 0,
  _discount_pct numeric default 0,
  _employee_id uuid default null,
  _staff_employee_id uuid default null,
  _approval_pin text default null,
  _meal_pin text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0; _tax numeric := 0; _total numeric; _discount numeric := 0; _manual_discount numeric := 0;
  _no int; _order_id uuid; _order_number text; _rate numeric; _line_rate numeric;
  _voucher jsonb; it jsonb; pay jsonb; grp record; _grp_net numeric;
  _items_out jsonb := '[]'::jsonb;
  _prog record; _mult numeric := 1; _earn int := 0;
  _max_pct numeric; _cap numeric; _threshold numeric; _used numeric; _staff record; _pct_of_gross numeric;
  _meal_daily_limit numeric; _meal_used numeric; _meal_amount numeric := 0; _residual numeric;
  _inv_reason text := 'sale';
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if jsonb_array_length(_items) = 0 then raise exception 'empty order'; end if;

  select tax_rate into _rate from orgs where id = _org;

  -- Snapshot each line's VAT rate (recipe override, else the org default) so
  -- a later recipe edit can never change what an already-placed order shows.
  for it in select * from jsonb_array_elements(_items) loop
    select tax_rate into _line_rate from recipes where id = (it->>'recipe_id')::uuid and org_id = _org;
    _subtotal := _subtotal + (it->>'price')::numeric * (it->>'qty')::numeric;
    _items_out := _items_out || jsonb_build_object(
      'recipe_id', it->>'recipe_id', 'name', it->>'name',
      'qty', (it->>'qty')::numeric, 'price', (it->>'price')::numeric,
      'tax_rate', coalesce(_line_rate, _rate)
    );
  end loop;

  -- Optional loyalty voucher
  if _redemption_code is not null and length(trim(_redemption_code)) > 0 then
    _voucher := loyalty_voucher_value(_org, _redemption_code, _subtotal);
    if (_voucher->>'valid')::boolean then
      _discount := coalesce((_voucher->>'discount')::numeric, 0);
    end if;
  end if;

  -- Manual staff discount (flat € + %), on top of any voucher, capped to the
  -- order's gross so a heavy-handed discount can never make the order negative.
  -- Ignored entirely on the meal-claim path below, which computes its own.
  _manual_discount := round(
    greatest(coalesce(_discount_amount, 0), 0)
    + (_subtotal * greatest(coalesce(_discount_pct, 0), 0) / 100),
    2
  );
  _manual_discount := least(_manual_discount, _subtotal);

  if _staff_employee_id is not null then
    select * into _staff from employees where id = _staff_employee_id and org_id = _org and is_active;
    if not found then
      raise exception 'staff discount: employee not found or inactive';
    end if;

    if _meal_pin is not null then
      -- ---- Staff meal/drink allowance: self-serve, own-PIN verified -------
      if _staff.pin is null or _staff.pin != _meal_pin then
        raise exception 'PIN doesn''t match — enter your own PIN to confirm it''s you';
      end if;

      select staff_meal_daily_limit into _meal_daily_limit from orgs where id = _org;
      if coalesce(_meal_daily_limit, 0) <= 0 then
        raise exception 'staff meals are not enabled for this restaurant';
      end if;

      select coalesce(sum(o.staff_meal_amount), 0) into _meal_used
        from orders o
       where o.org_id = _org
         and o.staff_discount_employee_id = _staff_employee_id
         and o.staff_meal_amount > 0
         and o.status not in ('void', 'refunded')
         and o.created_at >= date_trunc('day', now());

      _meal_amount := least(_subtotal, greatest(_meal_daily_limit - _meal_used, 0));
      _residual := _subtotal - _meal_amount;

      select staff_discount_max_pct into _max_pct from orgs where id = _org;
      _manual_discount := round(_meal_amount + _residual * greatest(coalesce(_max_pct, 0), 0) / 100, 2);
      _inv_reason := 'staff_meal';
    else
      -- ---- Existing "give a friend a discount" path (0033, unchanged) -----
      select staff_discount_max_pct, staff_discount_monthly_cap, staff_discount_pin_threshold
        into _max_pct, _cap, _threshold
        from orgs where id = _org;

      if coalesce(_max_pct, 0) <= 0 then
        raise exception 'staff discount is not enabled for this restaurant';
      end if;

      if _manual_discount <= 0 then
        raise exception 'staff discount: no discount amount given';
      end if;

      _pct_of_gross := case when _subtotal > 0 then _manual_discount * 100 / _subtotal else 0 end;
      if round(_pct_of_gross, 2) > _max_pct then
        raise exception 'staff discount of % percent exceeds the limit of % percent',
          round(_pct_of_gross, 1), _max_pct;
      end if;

      if _cap is not null then
        select coalesce(sum(o.staff_discount_amount), 0) into _used
          from orders o
         where o.org_id = _org
           and o.staff_discount_employee_id = _staff_employee_id
           and o.status not in ('void', 'refunded')
           and o.created_at >= date_trunc('month', now());
        if _used + _manual_discount > _cap then
          raise exception 'staff discount: % has only % left of a % monthly limit',
            _staff.name, round(greatest(_cap - _used, 0), 2), _cap;
        end if;
      end if;

      if _threshold is not null and _manual_discount > _threshold then
        if _approval_pin is null or not exists (
          select 1 from employees
           where org_id = _org and is_active and can_approve_discounts
             and pin is not null and pin = _approval_pin
        ) then
          raise exception 'staff discount over % needs a manager PIN', _threshold;
        end if;
      end if;
    end if;
  end if;

  _discount := least(_discount + _manual_discount, _subtotal);

  -- VAT extracted per rate group, not once on the whole order — a flat rate
  -- would be wrong the moment an order mixes food and drinks. Any discount is
  -- spread across the groups proportionally to their share of gross.
  for grp in
    select rate, sum(gross) as gross from (
      select coalesce((item.value->>'tax_rate')::numeric, _rate) as rate,
             (item.value->>'price')::numeric * (item.value->>'qty')::numeric as gross
      from jsonb_array_elements(_items_out) item
    ) lines
    group by rate
  loop
    _grp_net := greatest(
      grp.gross - (case when _subtotal > 0 then _discount * grp.gross / _subtotal else 0 end),
      0
    );
    _tax := _tax + round(_grp_net * grp.rate / (100 + grp.rate), 2);
  end loop;

  _total    := round(greatest(_subtotal - _discount, 0) + coalesce(_tip, 0), 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, table_id, customer_id, items, subtotal, tax, tip, total, discount,
                      status, kitchen_status, kitchen_notes, employee_id, staff_discount_employee_id, staff_discount_amount,
                      staff_meal_amount)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items_out, _subtotal, _tax, coalesce(_tip,0), _total, _discount,
          case when jsonb_array_length(_payments) > 0 then 'paid'::order_status else 'open'::order_status end,
          'new', _kitchen_notes, _employee_id, _staff_employee_id,
          case when _staff_employee_id is not null then _manual_discount - _meal_amount else 0 end,
          _meal_amount)
  returning id into _order_id;

  -- Mark voucher applied
  if _voucher is not null and (_voucher->>'valid')::boolean then
    update loyalty_redemptions set status = 'applied', applied_order_id = _order_id
      where id = (_voucher->>'redemption_id')::uuid;
  end if;

  for pay in select * from jsonb_array_elements(_payments) loop
    insert into payments (org_id, order_id, method, amount, tip_amount, split_label)
    values (_org, _order_id, (pay->>'method')::payment_method, (pay->>'amount')::numeric,
            coalesce((pay->>'tip_amount')::numeric, 0), pay->>'split_label');
  end loop;

  update inventory_items inv
  set stock = greatest(0, inv.stock - usage.used)
  from (
    select ri.inventory_item_id, sum(ri.qty_numeric * (it.value->>'qty')::numeric) as used
    from jsonb_array_elements(_items) it
    join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
    where ri.inventory_item_id is not null and ri.org_id = _org
    group by ri.inventory_item_id
  ) usage
  where inv.id = usage.inventory_item_id;

  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, ref_order_id)
  select _org, ri.inventory_item_id, ri.name, -sum(ri.qty_numeric * (it.value->>'qty')::numeric), _inv_reason::inv_reason, _order_id
  from jsonb_array_elements(_items) it
  join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
  where ri.inventory_item_id is not null and ri.org_id = _org
  group by ri.inventory_item_id, ri.name;

  -- Loyalty: configurable earn rate × tier multiplier
  if _customer_id is not null then
    update customers set visits = visits + 1, total_spend = total_spend + _total, last_visit_at = now()
      where id = _customer_id and org_id = _org;
    select * into _prog from loyalty_programs where org_id = _org;
    if found and _prog.enabled then
      select coalesce((t.perks->>'earn_multiplier')::numeric,1) into _mult
        from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _customer_id;
      _earn := floor(_total * coalesce(_prog.earn_rate,1) * coalesce(_mult,1))::int;
      if _earn > 0 then
        update customers set points = points + _earn, status_points = status_points + _earn
          where id = _customer_id and org_id = _org;
        insert into loyalty_transactions (org_id, customer_id, points_delta, reason, order_id, action_type)
          values (_org, _customer_id, _earn, 'Order ' || _order_number, _order_id, 'purchase');
      end if;
      perform loyalty_recompute_tier(_org, _customer_id);
    end if;
  end if;

  if _table_id is not null then
    update restaurant_tables set status = 'seated' where id = _table_id and org_id = _org;
  end if;

  if _order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, status)
    values (_org, _order_id, coalesce(_address, ''), 'pending');
  end if;

  return jsonb_build_object('order_id', _order_id, 'order_number', _order_number, 'total', _total, 'discount', _discount);
end $$;

grant execute on function public.staff_meal_usage(uuid, uuid) to authenticated;
grant execute on function public.staff_meal_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text, text) to authenticated;

-- ============================================================================
-- 0049 · Let staff set their own PIN
--
-- Until now a PIN was only ever set by a manager, in the Staff page's
-- Add/Edit Employee form — an employee had no way to see or change their
-- own. A PIN someone picks themselves gets remembered; one a manager typed
-- in once during onboarding and never mentioned again doesn't, which just
-- means the staff-meal self-serve (0048) and discount-approval (0033)
-- features it gates quietly stop getting used.
--
-- This can't just widen the employees_member_update policy from 0047 to let
-- a member update their own row — that reopens exactly the hole 0047 closed
-- (a staff account editing its own hourly_rate or is_active). Instead, one
-- narrow function that touches only the pin column of the caller's own
-- linked row, same shape as claim_employee().
-- ============================================================================

create or replace function public.set_my_pin(_org uuid, _pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _pin is not null and length(trim(_pin)) < 4 then
    raise exception 'PIN must be at least 4 digits';
  end if;

  update employees set pin = nullif(trim(_pin), '')
   where org_id = _org and user_id = auth.uid();

  if not found then
    raise exception 'No employee profile linked to your account yet — pick yourself on My Day first.';
  end if;
end $$;

grant execute on function public.set_my_pin(uuid, text) to authenticated;

-- ============================================================================
-- 0050 · Let a manager correct a time entry
--
-- 0047 removed the ability for anyone to write to time_entries except
-- through record_clock_in/record_clock_out/record_toggle_break — correct,
-- since a bare update let any org member fabricate hours. But those three
-- functions only ever act "as of now": there was no way left for a manager
-- to fix a stuck-open shift (clock_out stuck at null for two days, say) or
-- correct a mistaken clock-in/out time after the fact. This adds exactly
-- that, manager+ only, with no other write path re-opened.
-- ============================================================================

create or replace function public.edit_time_entry(
  _org uuid,
  _entry uuid,
  _clock_in timestamptz,
  _clock_out timestamptz default null,
  _break_seconds integer default 0,
  _note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager') then
    raise exception 'manager access required to edit a time entry';
  end if;
  if _clock_in is null then raise exception 'clock-in time is required'; end if;
  if _clock_out is not null and _clock_out <= _clock_in then
    raise exception 'clock-out must be after clock-in';
  end if;
  if coalesce(_break_seconds, 0) < 0 then raise exception 'break time cannot be negative'; end if;

  update time_entries set
    clock_in = _clock_in,
    clock_out = _clock_out,
    break_seconds = coalesce(_break_seconds, 0),
    -- A manual edit always fully resolves the entry — leaving a running
    -- break in place would let workedSeconds() keep counting down live on a
    -- shift a manager just believed they'd closed.
    break_started_at = null,
    note = coalesce(_note, note)
  where id = _entry and org_id = _org;

  if not found then raise exception 'time entry not found'; end if;
end $$;

grant execute on function public.edit_time_entry(uuid, uuid, timestamptz, timestamptz, integer, text) to authenticated;

-- ============================================================================
-- 0054 · Let a manager/partner save the menu category order
--
-- CategoryOrderModal (Recipes page) is meant for a manager to fix, and any
-- org member with Recipes access can open it and drag categories around —
-- but saving goes through updateOrg(), which updates the whole `orgs` row,
-- and orgs_admin_update only allows owner/admin. A manager or partner
-- (Josna, running the restaurant day-to-day) hit a silent RLS failure
-- trying to save a reorder that the feature itself was built for them to do.
--
-- Rather than widening orgs_admin_update itself — that row also carries
-- business info and payment/TSE credentials that should stay owner/admin
-- only — this is a narrowly-scoped RPC that can only ever touch
-- settings.categoryOrder, open to manager/partner as well.
-- ============================================================================

create or replace function public.set_category_order(_org uuid, _order jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager', 'partner') then
    raise exception 'not authorized';
  end if;

  update orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{categoryOrder}', _order, true)
   where id = _org;
end $$;

grant execute on function public.set_category_order(uuid, jsonb) to authenticated;

-- ============================================================================
-- 0055 · Role-based daily task assignments
--
-- Extends tasks table to support:
-- - assigned_role: which staff role this task targets (frontend, kitchen_lead, commi_kitchen)
-- - is_daily: whether this task repeats daily
-- - department: grouping for organization (front_of_house, kitchen, etc)
--
-- Allows creating daily recurring checklists for different positions, auto-assigned
-- to staff members based on their assigned role.
-- ============================================================================

alter table public.tasks
  add column if not exists assigned_role text,
  add column if not exists is_daily boolean not null default false,
  add column if not exists department text;

-- Enum for staff roles
do $$ begin create type public.staff_role as enum ('frontend', 'kitchen_lead', 'commi_kitchen', 'owner', 'admin', 'manager'); exception when duplicate_object then null; end $$;

-- Enum for departments  
do $$ begin create type public.department as enum ('front_of_house', 'kitchen', 'management'); exception when duplicate_object then null; end $$;

-- Add constraints
alter table public.tasks
  alter column assigned_role type public.staff_role using assigned_role::public.staff_role,
  alter column department type public.department using department::public.department;

-- Index for faster role-based task lookups
create index if not exists idx_tasks_assigned_role on public.tasks(org_id, assigned_role) where assigned_role is not null;
create index if not exists idx_tasks_is_daily on public.tasks(org_id, is_daily) where is_daily = true;

comment on column public.tasks.assigned_role is 'Staff role this task is assigned to (frontend, kitchen_lead, commi_kitchen)';
comment on column public.tasks.is_daily is 'Whether this is a daily recurring task';
comment on column public.tasks.department is 'Department grouping (front_of_house, kitchen, management)';

-- ============================================================================
-- 0056 · Duty assignments + starter daily checklists
--
-- 1. duty_assignments: who holds each duty (frontend / kitchen_lead /
--    commi_kitchen). A person is either an employee row (staff) or a login
--    (partner / manager), never both in one row. Anyone holding a duty gets
--    every task assigned to it — daily checklists and one-off tasks alike.
--    Readable by every member (so colleagues can see who covers what);
--    only owner/admin/manager can change it.
--
-- 2. seed_daily_tasks(org): loads the starter checklists (idempotent — skips
--    a title that already exists as a daily task) and is run once for
--    Kokoland below. Content mirrors src/data/daily-task-templates.ts.
--
-- Requires 0055 (staff_role / department enums, tasks.assigned_role etc.).
-- ============================================================================

-- The starter checklists keep their steps in tasks.checklist / tasks.links, which migration
-- 0024 added. At least one database (production, 2026-09-21) never got 0024 and failed here
-- with 'column "checklist" of relation "tasks" does not exist', so add them here too.
-- Harmless where they already exist.
alter table public.tasks
  add column if not exists checklist jsonb not null default '[]'::jsonb,
  add column if not exists links jsonb not null default '[]'::jsonb;

create table if not exists public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  duty public.staff_role not null,
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint duty_assignments_one_person check ((employee_id is null) <> (user_id is null))
);

create unique index if not exists duty_assignments_employee_uq
  on public.duty_assignments (org_id, duty, employee_id) where employee_id is not null;
create unique index if not exists duty_assignments_user_uq
  on public.duty_assignments (org_id, duty, user_id) where user_id is not null;

alter table public.duty_assignments enable row level security;

drop policy if exists duty_assignments_member_select on public.duty_assignments;
create policy duty_assignments_member_select on public.duty_assignments for select
  using (is_org_member(org_id));
drop policy if exists duty_assignments_manager_insert on public.duty_assignments;
create policy duty_assignments_manager_insert on public.duty_assignments for insert
  with check (has_org_role(org_id,'owner','admin','manager'));
drop policy if exists duty_assignments_manager_delete on public.duty_assignments;
create policy duty_assignments_manager_delete on public.duty_assignments for delete
  using (has_org_role(org_id,'owner','admin','manager'));

-- ---- Daily Tasks module: register it and grant it by default ---------------
-- Same function as 0045 with 'dailytasks' added for manager and staff. Inserting
-- the module row fires on_module_added (0041), which grants it to every
-- existing member whose role default includes it.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

insert into public.modules (id, name, grouping, sort)
values ('dailytasks', 'Daily Tasks', 'Operate', 13)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- Photos: a reference "how it should look" picture per task, an optional
-- must-attach-a-photo rule, and the photos people upload as proof. Files live
-- in the existing public org-assets bucket; only their URLs are stored here.
alter table public.tasks
  add column if not exists example_photo_url text,
  add column if not exists requires_photo boolean not null default false,
  add column if not exists proof_photos jsonb not null default '[]'::jsonb;

create or replace function public.seed_daily_tasks(_org uuid)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  insert into public.tasks
    (org_id, title, description, priority, position, assigned_role, is_daily, department, checklist, requires_photo)
  select _org, v.title, v.descr, v.prio::task_priority, 100 + v.ord,
         v.role::public.staff_role, true, v.dept::public.department,
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', u.s, 'done', false) order by u.o)
              from unnest(v.steps) with ordinality as u(s, o)),
           '[]'::jsonb),
         v.photo
    from (values
    (0, 'Front-of-house open check', 'Lights, music, card terminal and till float ready', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (1, 'Guest area setup', 'Wipe tables, set cutlery caddies, check takeaway packing stock (boxes, bags, lids)', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (2, 'Prepare drinks', 'Coconut Thunder, Pina Colada and lemonades with Naruneendi ready to serve', 'high', 'frontend', 'front_of_house', array['Coconut Thunder', 'Pina Colada', 'Lemonades with Naruneendi']::text[], false),
    (3, 'Prepare cocktails', 'All cocktail ingredients, garnishes and glasses ready', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (4, 'Pack main dishes', 'Take mains from the bain-marie and pack for takeaway', 'high', 'frontend', 'front_of_house', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (5, 'Rice and heating', 'Rice cooked and kept hot; heat dishes before serving', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (6, 'Check drink stock (5+ portions)', 'Always at least 5 portions of each drink ready', 'high', 'frontend', 'front_of_house', array['Coconut Thunder', 'Pina Colada', 'Lemonades with Naruneendi']::text[], false),
    (7, 'Check cutlery, plates & glasses', 'Enough cutlery, main plates and glasses at the front', 'high', 'frontend', 'front_of_house', array['Cutlery', 'Main plates', 'Glasses']::text[], false),
    (8, 'Check front inventory', 'Enough of the front-line staples before service', 'high', 'frontend', 'front_of_house', array['Porotta', 'Coconut milk', 'Oil', 'Ketchup']::text[], false),
    (9, 'Inventory in its proper place', 'Every inventory item stored in its labelled location, easy for anyone to find', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (10, 'Allergen & label check', 'Allergen info and labels match today''s dishes', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (11, 'Clean front desk & tables', 'Front desk, tables and under the tables', 'medium', 'frontend', 'front_of_house', '{}'::text[], true),
    (12, 'Clean floors', 'Sweep and mop the guest area', 'medium', 'frontend', 'front_of_house', '{}'::text[], true),
    (13, 'Clean guest toilets & urinals', 'Toilets, urinals, sinks and floor', 'high', 'frontend', 'front_of_house', '{}'::text[], true),
    (14, 'Check tissue & toilet paper', 'Tissue and toilet paper stocked in every restroom', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (15, 'Clean mirrors', 'Front area and restroom mirrors', 'low', 'frontend', 'front_of_house', '{}'::text[], false),
    (16, 'Close till', 'Count and close the till, complete the end-of-day cash out', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (17, 'Lock-up check', 'Lights off, doors, windows and card terminal closed', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (18, 'Chiller & bain-marie temperature log', 'Record every chiller, freezer and the bain-marie; flag anything out of range', 'high', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (19, 'Cooked dish locations', 'Each cooked dish is in its assigned chiller; note which chiller holds which item', 'high', 'kitchen_lead', 'kitchen', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (20, 'Label cooked dishes (FIFO)', 'Date and label every cooked dish before it goes in the chiller', 'high', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (21, 'Recipe check', 'Every dish cooked to its recipe; recipes in DishData complete and current', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (22, 'Prep list for the day', 'Set prep quantities per dish from recent sales', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (23, 'Delivery check', 'Check incoming goods for quantity, damage and expiry before signing', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (24, 'Waste log', 'Record what was thrown away and why', 'low', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (25, 'Clean kitchen floors', 'Sweep and mop all kitchen floors', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], true),
    (26, 'Wash dishes', 'All dishes washed, sink area clean', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (27, 'Check bain-marie stock (5+ portions)', 'At least 5 portions of each main dish in the bain-marie', 'high', 'commi_kitchen', 'kitchen', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (28, 'Check curry plates', 'Enough curry plates ready for service', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (29, 'Hand-wash station check', 'Soap, paper towels and hot water at every sink', 'low', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (30, 'Bins and trash out', 'Empty all bins, take waste out, replace liners', 'medium', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (31, 'Equipment off', 'Grill, stove, fryer and extractor off; gas closed', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (32, 'Clean grill', 'Grill surface and grates; match the example photo', 'high', null::text, 'kitchen', array['Scrape grates', 'Degrease surface', 'Wipe outside']::text[], true),
    (33, 'Clean stove', 'Burners, hob and surrounding wall; match the example photo', 'high', null::text, 'kitchen', array['Remove and wash burner caps', 'Degrease hob', 'Wipe wall and knobs']::text[], true),
    (34, 'Clean work table between stations', 'Work table in between stations; match the example photo', 'medium', null::text, 'kitchen', array['Clear the table', 'Scrub and sanitise', 'Dry and reset']::text[], true),
    (35, 'Clean employee toilet', 'Toilet, sink, floor and supplies', 'medium', null::text, 'front_of_house', '{}'::text[], true)
    ) as v(ord, title, descr, prio, role, dept, steps, photo)
   where not exists (
     select 1 from public.tasks t where t.org_id = _org and t.is_daily and t.title = v.title
   );
  get diagnostics n = row_count;
  return n;
end $$;

-- Not granted to app users: it's run from the SQL editor.
revoke all on function public.seed_daily_tasks(uuid) from public, anon, authenticated;



-- ============================================================================
-- 0058 · Marketing foundations: social accounts, posts, unified inbox
--
-- Phase 0 of the Marketing expansion (Google Business, Instagram/Facebook,
-- TikTok, and one inbox for every customer message). Schema only — the
-- providers arrive in later phases.
--
--   org_profile          address / phone / hours / website for the venue
--                        (Google Business Profile needs them structured)
--   social_accounts      one row per connected external account. Holds NO
--                        secrets; safe to select from the browser.
--   social_credentials   the OAuth tokens (encrypted by the app). RLS on, NO
--                        policies and revoked from anon/authenticated → only the
--                        service-role key can read it. Stronger than
--                        channels.credentials, which relies on the client
--                        never selecting the column.
--   outbound_posts         a piece of content, plus one outbound_post_targets row
--                        per account it goes to (status, permalink, retries)
--   conversations        one thread per customer per channel: Messenger,
--   messages             Instagram, SMS, email, website chat, Google reviews
--   quick_replies        canned answers
--
-- NOTE: the publishing queue is called outbound_posts / outbound_post_targets on
-- purpose. 0057 already owns social_posts (the manual content calendar) and
-- social_targets (weekly posting goals); this is a different table.
--
-- Provider / channel / status columns are text + CHECK, not enums, so adding a
-- value never hits the "new enum value can't be used in the same transaction"
-- problem (see 0043).
--
-- Also: managers get the Marketing module by default (default_modules_for_role
-- + a backfill for members who already have explicit per-module rows, the 0037
-- pattern), and has_module_access() lets RLS enforce the module gate for
-- tables that hold customer PII — the client-side RequireModule alone is not a
-- boundary.
-- ============================================================================

-- ---- 1. Module gate usable from RLS ----------------------------------------
-- Mirrors useOrg.tsx: owner/admin always; otherwise the member's explicit rows;
-- otherwise (no rows at all) the role default.
create or replace function public.has_module_access(_org uuid, _module text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_members om
    where om.org_id = _org and om.user_id = auth.uid()
      and (
        om.role::text in ('owner','admin')
        or exists (
          select 1 from public.member_module_access ma
          where ma.org_id = om.org_id and ma.user_id = om.user_id
            and ma.module_id = _module and ma.can_access
        )
        or (
          not exists (
            select 1 from public.member_module_access ma2
            where ma2.org_id = om.org_id and ma2.user_id = om.user_id
          )
          and _module = any(public.default_modules_for_role(om.role))
        )
      )
  )
$$;

-- ---- 2. Managers get Marketing by default ----------------------------------
-- Same function as 0056 with 'marketing' added for manager.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks','marketing']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

-- Existing managers who already have explicit per-module rows (a lone row would
-- otherwise flip a member into explicit mode and hide their other modules).
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select distinct om.org_id, om.user_id, 'marketing', true
from public.org_members om
where om.role::text = 'manager'
  and exists (
    select 1 from public.member_module_access ma
    where ma.org_id = om.org_id and ma.user_id = om.user_id
  )
on conflict (org_id, user_id, module_id) do nothing;

-- ---- 3. Venue profile ------------------------------------------------------
create table if not exists public.org_profile (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  description text,
  phone text,
  website text,
  address_line text,
  postal_code text,
  city text,
  country text not null default 'DE',
  google_place_id text,
  categories text[] not null default '{}',
  -- {"mon":[{"open":"11:00","close":"22:00"}], ..., "sun":[]}; empty day = closed
  hours jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- address / phone used to live as loose keys in orgs.settings.
insert into public.org_profile (org_id, phone, address_line)
select o.id, nullif(o.settings->>'phone', ''), nullif(o.settings->>'address', '')
from public.orgs o
on conflict (org_id) do nothing;

-- ---- 4. Connected social accounts ------------------------------------------
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null
    check (provider in ('google_business','facebook','instagram','tiktok','tiktok_shop','meta_catalog')),
  -- The platform's id for the asset: IG user id, FB page id, GBP location name…
  external_id text not null,
  display_name text not null default '',
  handle text,
  avatar_url text,
  scopes text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  -- Set by the server when the refresh token dies; the UI shows "Reconnect".
  needs_reauth boolean not null default false,
  token_expires_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (org_id, provider, external_id)
);

create table if not exists public.social_credentials (
  account_id uuid primary key references public.social_accounts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- AES-256-GCM blobs written by src/lib/social/crypto.ts, never plaintext.
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.social_credentials enable row level security;
revoke all on table public.social_credentials from anon, authenticated;

-- ---- 5. Posts + per-account publish state ----------------------------------
create table if not exists public.outbound_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  caption text not null default '',
  -- [{"url": "...", "type": "image"|"video", "w": 1080, "h": 1350}]
  media jsonb not null default '[]'::jsonb,
  recipe_id uuid references public.recipes(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','scheduled','publishing','published','partial','failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  ai_generated boolean not null default false,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index if not exists outbound_posts_org_status_idx on public.outbound_posts (org_id, status, scheduled_at);

create table if not exists public.outbound_post_targets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.outbound_posts(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.social_accounts(id) on delete cascade,
  provider text not null,
  status text not null default 'pending'
    check (status in ('pending','publishing','published','failed','skipped')),
  external_id text,
  permalink text,
  -- Persisted BEFORE the final publish call so a retry resumes instead of
  -- double-posting (Instagram container id / TikTok publish id).
  container_id text,
  publish_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  error text,
  metrics jsonb not null default '{}'::jsonb,
  metrics_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, account_id)
);
create index if not exists outbound_post_targets_due_idx
  on public.outbound_post_targets (status, next_attempt_at)
  where status in ('pending','publishing');

-- Atomically hand due targets to ONE cron run. `skip locked` means two
-- overlapping runs never receive the same row. A target stuck in 'publishing'
-- (crashed worker) is reclaimed after 10 minutes and resumes from its
-- container_id/publish_id. Service-role only.
create or replace function public.claim_due_outbound_targets(_limit integer default 10)
returns setof public.outbound_post_targets
language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select t.id
    from public.outbound_post_targets t
    join public.outbound_posts p on p.id = t.post_id
    where p.status in ('scheduled','publishing')
      and (
        (t.status = 'pending'
          and coalesce(t.next_attempt_at, p.scheduled_at, now()) <= now())
        or (t.status = 'publishing' and t.updated_at < now() - interval '10 minutes')
      )
    order by coalesce(t.next_attempt_at, p.scheduled_at, t.created_at)
    limit _limit
    for update of t skip locked
  )
  update public.outbound_post_targets t
     set status = 'publishing', attempts = t.attempts + 1, updated_at = now()
    from due
   where t.id = due.id
  returning t.*;
end $$;
revoke all on function public.claim_due_outbound_targets(integer) from public, anon, authenticated;

-- ---- 6. Unified inbox ------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel text not null
    check (channel in ('facebook','instagram','whatsapp','sms','email','webchat','google_review')),
  kind text not null default 'message' check (kind in ('message','comment','review')),
  account_id uuid references public.social_accounts(id) on delete set null,
  -- Platform thread id (PSID, phone number, email Message-ID root, chat token…).
  external_thread_id text not null,
  -- {"name","handle","email","phone","avatar"}
  contact jsonb not null default '{}'::jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  rating smallint check (rating between 1 and 5),
  subject text,
  status text not null default 'open' check (status in ('open','pending','closed')),
  assignee_id uuid references auth.users(id) on delete set null,
  unread_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, channel, external_thread_id)
);
create index if not exists conversations_org_status_idx
  on public.conversations (org_id, status, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  -- Platform message id: makes webhook redelivery idempotent. NULL for an
  -- outbound message not yet accepted by the platform (NULLs never collide).
  external_id text,
  status text not null default 'received'
    check (status in ('received','queued','sent','delivered','read','failed')),
  error text,
  sent_by uuid references auth.users(id),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- Keep the thread header honest without every webhook having to remember to:
-- bump last_message_at, count unread inbound, reopen a closed thread.
create or replace function public.bump_conversation_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations c set
    last_message_at = new.created_at,
    last_inbound_at = case when new.direction = 'in' then new.created_at else c.last_inbound_at end,
    unread_count = c.unread_count + case when new.direction = 'in' then 1 else 0 end,
    status = case when new.direction = 'in' and c.status = 'closed' then 'open' else c.status end,
    updated_at = now()
  where c.id = new.conversation_id;
  return new;
end $$;

drop trigger if exists bump_conversation_on_message on public.messages;
create trigger bump_conversation_on_message
  after insert on public.messages
  for each row execute function public.bump_conversation_on_message();

create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  body text not null,
  -- Empty = offered on every channel.
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- ---- 7. Triggers -----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['org_profile','social_accounts','outbound_posts','outbound_post_targets','conversations'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['social_accounts','outbound_posts','quick_replies'] loop
    execute format('drop trigger if exists set_created_by on public.%I', t);
    execute format('create trigger set_created_by before insert on public.%I for each row execute function public.set_created_by()', t);
  end loop;
end $$;

-- ---- 8. RLS ----------------------------------------------------------------
-- Customer messages and reviews are PII → gated by the Marketing module in the
-- database, not just in the UI. Server code (webhooks, cron, sending) uses the
-- service-role key and so never depends on these policies.
alter table public.org_profile enable row level security;
alter table public.social_accounts enable row level security;
alter table public.outbound_posts enable row level security;
alter table public.outbound_post_targets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.quick_replies enable row level security;

-- org_profile: any member reads (it is the venue's public details); managers edit.
drop policy if exists org_profile_member_select on public.org_profile;
create policy org_profile_member_select on public.org_profile for select
  using (is_org_member(org_id));
drop policy if exists org_profile_editor_insert on public.org_profile;
create policy org_profile_editor_insert on public.org_profile for insert
  with check (has_org_role(org_id,'owner','admin','partner','manager'));
drop policy if exists org_profile_editor_update on public.org_profile;
create policy org_profile_editor_update on public.org_profile for update
  using (has_org_role(org_id,'owner','admin','partner','manager'));

-- social_accounts: marketing users see them; only owner/admin connect/change.
drop policy if exists social_accounts_select on public.social_accounts;
create policy social_accounts_select on public.social_accounts for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists social_accounts_admin_insert on public.social_accounts;
create policy social_accounts_admin_insert on public.social_accounts for insert
  with check (has_org_role(org_id,'owner','admin'));
drop policy if exists social_accounts_admin_update on public.social_accounts;
create policy social_accounts_admin_update on public.social_accounts for update
  using (has_org_role(org_id,'owner','admin'));
drop policy if exists social_accounts_admin_delete on public.social_accounts;
create policy social_accounts_admin_delete on public.social_accounts for delete
  using (has_org_role(org_id,'owner','admin'));

-- outbound_posts / targets: marketing users read; owner/admin/partner/manager write.
do $$
declare t text;
begin
  foreach t in array array['outbound_posts','outbound_post_targets'] loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select using (has_module_access(org_id, ''marketing''))', t, t);
    execute format('drop policy if exists %I_editor_insert on public.%I', t, t);
    execute format('create policy %I_editor_insert on public.%I for insert with check (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
    execute format('drop policy if exists %I_editor_update on public.%I', t, t);
    execute format('create policy %I_editor_update on public.%I for update using (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
    execute format('drop policy if exists %I_editor_delete on public.%I', t, t);
    execute format('create policy %I_editor_delete on public.%I for delete using (has_module_access(org_id, ''marketing'') and has_org_role(org_id,''owner'',''admin'',''partner'',''manager''))', t, t);
  end loop;
end $$;

-- conversations: marketing users read and triage (assign, close, mark read).
-- Rows are created by webhooks and the send route, never by the browser.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations for update
  using (has_module_access(org_id, 'marketing'));
drop policy if exists conversations_admin_delete on public.conversations;
create policy conversations_admin_delete on public.conversations for delete
  using (has_org_role(org_id,'owner','admin'));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists messages_admin_delete on public.messages;
create policy messages_admin_delete on public.messages for delete
  using (has_org_role(org_id,'owner','admin'));

-- quick_replies: anyone with Marketing manages the canned answers.
drop policy if exists quick_replies_select on public.quick_replies;
create policy quick_replies_select on public.quick_replies for select
  using (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_insert on public.quick_replies;
create policy quick_replies_insert on public.quick_replies for insert
  with check (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_update on public.quick_replies;
create policy quick_replies_update on public.quick_replies for update
  using (has_module_access(org_id, 'marketing'));
drop policy if exists quick_replies_delete on public.quick_replies;
create policy quick_replies_delete on public.quick_replies for delete
  using (has_module_access(org_id, 'marketing'));

-- ---- 9. Realtime (live inbox + publish status) -----------------------------
do $$ begin alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.outbound_post_targets;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- 0057 · Social planner (Marketing)
--
-- social_posts / social_targets: the content calendar and weekly targets inside
--   Marketing. Owners, admins, partners and managers can edit; every member can
--   read. Platform/status/format are text with CHECKs (no enums to migrate).
--
-- Seeds Kokoland's default weekly targets. Idempotent. (Bain-marie counts now live in
-- kitchen_dishes, migration 0059.)
-- ============================================================================

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  caption text,
  platform text not null default 'instagram' check (platform in ('instagram','tiktok','facebook','google')),
  format text not null default 'post' check (format in ('post','reel','story','video')),
  status text not null default 'idea' check (status in ('idea','drafted','scheduled','posted')),
  scheduled_for date,
  owner_user_id uuid references auth.users(id) on delete set null,
  link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_org_day_idx on public.social_posts (org_id, scheduled_for);

create table if not exists public.social_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','facebook','google')),
  posts_per_week integer not null default 3 check (posts_per_week >= 0),
  followers_now integer,
  followers_goal integer,
  unique (org_id, platform)
);

drop trigger if exists social_posts_updated on public.social_posts;
create trigger social_posts_updated before update on public.social_posts
  for each row execute function public.set_updated_at();

alter table public.social_posts enable row level security;
alter table public.social_targets enable row level security;

-- Social: read for members, write for marketing roles.
drop policy if exists social_posts_member_select on public.social_posts;
create policy social_posts_member_select on public.social_posts for select using (is_org_member(org_id));
drop policy if exists social_posts_editor_write on public.social_posts;
create policy social_posts_editor_write on public.social_posts for all
  using (has_org_role(org_id,'owner','admin','partner','manager'))
  with check (has_org_role(org_id,'owner','admin','partner','manager'));

drop policy if exists social_targets_member_select on public.social_targets;
create policy social_targets_member_select on public.social_targets for select using (is_org_member(org_id));
drop policy if exists social_targets_editor_write on public.social_targets;
create policy social_targets_editor_write on public.social_targets for all
  using (has_org_role(org_id,'owner','admin','partner','manager'))
  with check (has_org_role(org_id,'owner','admin','partner','manager'));

-- Kokoland starter data.
insert into public.social_targets (org_id, platform, posts_per_week)
select o.id, t.platform, t.n
from public.orgs o,
     (values ('instagram', 4), ('tiktok', 2), ('facebook', 2), ('google', 1)) as t(platform, n)
where o.name ilike 'kokoland%'
on conflict (org_id, platform) do nothing;

-- ============================================================================
-- 0059 · Kitchen Ops: production standards, live kitchen counts, kitchen log,
--        ticket timing, and the Kitchen Ops module
--
-- kitchen_dishes: one row per production component (Porotta, Chicken Curry, ...):
--   how it is made/held/finished, batch + reorder rules, and the LIVE counts the
--   line updates (hot_portions in the bain-marie/hot box, fridge_portions chilled, or the
--   freezer for items bought frozen: porotta, uzhunnuvada, parippuvada, pathiri).
--   "terms" are lowercase fragments: an order line containing one counts a portion
--   of that component, so "Porotta with Beef Curry" uses Porotta AND Beef Curry.
--   Any member can update counts; only owner/admin/manager add or remove dishes.
-- kitchen_log: cooked / wasted / stockout events (waste %, "runs out often", etc).
-- orders.kitchen_*_at: stamped by a trigger when a ticket changes kitchen status,
--   which is what makes prep time and customer wait measurable.
--
-- Seeds Kokoland's 26 components (from the 26 Aug - 19 Sep 2026 sales export).
-- Idempotent. Supersedes the unused bain_marie_items table from the first 0057 draft.
-- ============================================================================

create table if not exists public.kitchen_dishes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete set null,
  dish text not null,
  terms text not null default '',
  method text not null default 'hot_hold'
    check (method in ('hot_hold','fridge_reheat','pan_finish','fresh','batch_portion','assembly')),
  bain_marie text not null default 'no' check (bain_marie in ('yes','limited','no')),
  open_pct numeric not null default 0.8 check (open_pct >= 0 and open_pct <= 1),
  portion text not null default '1 serving',
  portion_g integer,
  frozen boolean not null default false,
  station text not null default 'curry',
  container text not null default '',
  batch_portions integer not null default 3 check (batch_portions >= 0),
  min_portions integer not null default 1 check (min_portions >= 0),
  reorder_at integer not null default 2 check (reorder_at >= 0),
  prep_minutes integer not null default 30,
  finish_minutes integer not null default 2,
  target_wait_min integer not null default 5,
  hold_temp_c integer,
  max_hold_min integer,
  notes text not null default '',
  hot_portions integer not null default 0 check (hot_portions >= 0),
  fridge_portions integer not null default 0 check (fridge_portions >= 0),
  position integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (org_id, dish)
);

create table if not exists public.kitchen_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  dish text not null,
  kind text not null check (kind in ('cooked','wasted','stockout')),
  portions numeric not null default 0,
  value numeric not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists kitchen_log_org_time_idx on public.kitchen_log (org_id, created_at desc);

alter table public.orders
  add column if not exists kitchen_started_at timestamptz,
  add column if not exists kitchen_ready_at timestamptz,
  add column if not exists kitchen_served_at timestamptz;

create or replace function public.stamp_kitchen_times()
returns trigger language plpgsql as $$
begin
  if new.kitchen_status is distinct from old.kitchen_status then
    if new.kitchen_status::text in ('preparing','ready','served') and new.kitchen_started_at is null then
      new.kitchen_started_at := now();
    end if;
    if new.kitchen_status::text in ('ready','served') and new.kitchen_ready_at is null then
      new.kitchen_ready_at := now();
    end if;
    if new.kitchen_status::text = 'served' and new.kitchen_served_at is null then
      new.kitchen_served_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_stamp_kitchen_times on public.orders;
create trigger orders_stamp_kitchen_times before update on public.orders
  for each row execute function public.stamp_kitchen_times();

alter table public.kitchen_dishes enable row level security;
alter table public.kitchen_log enable row level security;

drop policy if exists kitchen_dishes_member_select on public.kitchen_dishes;
create policy kitchen_dishes_member_select on public.kitchen_dishes for select using (is_org_member(org_id));
drop policy if exists kitchen_dishes_member_update on public.kitchen_dishes;
create policy kitchen_dishes_member_update on public.kitchen_dishes for update using (is_org_member(org_id));
drop policy if exists kitchen_dishes_manager_insert on public.kitchen_dishes;
create policy kitchen_dishes_manager_insert on public.kitchen_dishes for insert
  with check (has_org_role(org_id,'owner','admin','manager'));
drop policy if exists kitchen_dishes_manager_delete on public.kitchen_dishes;
create policy kitchen_dishes_manager_delete on public.kitchen_dishes for delete
  using (has_org_role(org_id,'owner','admin','manager'));

drop policy if exists kitchen_log_member_select on public.kitchen_log;
create policy kitchen_log_member_select on public.kitchen_log for select using (is_org_member(org_id));
drop policy if exists kitchen_log_member_insert on public.kitchen_log;
create policy kitchen_log_member_insert on public.kitchen_log for insert with check (is_org_member(org_id));
drop policy if exists kitchen_log_manager_delete on public.kitchen_log;
create policy kitchen_log_manager_delete on public.kitchen_log for delete
  using (has_org_role(org_id,'owner','admin','manager'));

-- Kitchen Ops module: granted to staff and managers by default (owners/admins/partners get every module).
-- Same function as 0058 with 'kitchenops' added.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks','marketing','kitchenops']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks','kitchenops']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

insert into public.modules (id, name, grouping, sort)
values ('kitchenops', 'Kitchen Ops', 'Operate', 14)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- Kokoland's production plan. Links each component to the menu recipe of the same name where one exists.
insert into public.kitchen_dishes
  (org_id, recipe_id, position, dish, terms, method, bain_marie, open_pct, frozen, station, container,
   batch_portions, min_portions, reorder_at, prep_minutes, finish_minutes, target_wait_min,
   hold_temp_c, max_hold_min, notes)
select o.id,
       (select r.id from public.recipes r where r.org_id = o.id and lower(r.name) = lower(v.dish) limit 1),
       v.pos, v.dish, v.terms, v.method, v.bain, v.open_pct, v.frozen, v.station, v.container,
       v.batch, v.minp, v.reorder, v.prep, v.finish, v.wait, v.hold, v.maxhold, v.notes
from public.orgs o,
     (values
    (1, 'Porotta', 'porotta,parotta', 'hot_hold', 'no', 1, true, 'tawa', 'Covered hot tray', 8, 2, 4, 8, 1, 3, 65, 90, 'Bought frozen: cook from frozen in rolling mini-batches of 8 and count the freezer too. Confirm pieces per serving with the chef.'),
    (2, 'Chicken Curry', 'chicken curry,chicken mix', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 4, 1, 2, 45, 1, 3, 65, 180, 'Small live batch; chilled backup; rapid reheat before hot holding.'),
    (3, 'Puttu', 'puttu', 'batch_portion', 'no', 1, false, 'steam', 'Portion cups', 2, 1, 1, 15, 8, 9, 65, 20, 'Pre-portion flour and coconut; steam fresh to order.'),
    (4, 'Beef Roast', 'beef roast', 'pan_finish', 'no', 1, false, 'pan', 'Portion tray', 4, 1, 2, 75, 4, 8, 65, 30, 'Pre-cook and portion; finish and reduce in the pan for texture.'),
    (5, 'Chicken Biriyani', 'chicken biriyani,chicken biryani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN / insulated pot', 4, 1, 2, 75, 2, 4, 65, 120, 'Plan batches; never the whole day at once; protect rice texture.'),
    (6, 'Gobi Manchurian', 'gobi', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 3, 1, 1, 20, 6, 8, null, null, 'Pre-prep florets and sauce; fry/toss fresh.'),
    (7, 'Beef Curry', 'beef curry,beef mix', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 3, 1, 2, 90, 1, 3, 65, 180, 'Good bain-marie candidate; avoid holding the whole day''s batch.'),
    (8, 'Beef Fry / Dry Fry', 'beef fry,beef dry fry,dry fry', 'pan_finish', 'no', 1, false, 'pan', 'Portion tray', 4, 1, 2, 60, 4, 8, 65, 30, 'Do not bain-marie; finish dry in the pan.'),
    (9, 'Kadala Curry', 'kadala', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 3, 1, 1, 60, 1, 3, 65, 180, 'Stable small-batch hot-hold candidate. Soak chickpeas the night before.'),
    (10, 'Paneer Butter Masala', 'paneer butter masala', 'hot_hold', 'yes', 0.65, false, 'curry', 'GN 1/3', 3, 1, 2, 35, 1, 3, 65, 120, 'Smaller live batch to protect paneer texture.'),
    (11, 'Veg Kurma', 'kurma,kuruma', 'hot_hold', 'yes', 0.65, false, 'curry', 'GN 1/3', 2, 1, 1, 35, 1, 3, 65, 120, 'Keep the batch small because demand is lower.'),
    (12, 'Pazhampori', 'pazhampori,pazham pori,banana fritters', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 4, 1, 2, 15, 5, 8, null, null, 'Prep fruit and batter; fry fresh.'),
    (13, 'Chicken Cutlet', 'cutlet', 'fresh', 'no', 1, false, 'fryer', 'Portion tray', 3, 1, 1, 30, 5, 8, null, null, 'Pre-made; fry or reheat to order. Count ready portions before the rush.'),
    (14, 'Chicken 65', 'chicken 65', 'fresh', 'no', 1, false, 'fryer', 'Portion tray', 3, 1, 1, 30, 6, 8, null, null, 'Marinate and portion ahead; keep ready-to-fry portions; never hold fried chicken.'),
    (15, 'Onion Pakoda', 'onion pakoda', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 3, 1, 1, 15, 6, 8, null, null, 'Prepare enough mix for the next rush; fry to order.'),
    (16, 'Paneer Biriyani', 'paneer biriyani,paneer biryani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN 1/2', 3, 1, 1, 60, 2, 4, 65, 120, 'Smaller batch than chicken biriyani.'),
    (17, 'Rice', 'rice', 'hot_hold', 'limited', 0.8, false, 'rice', 'Rice hot-hold container', 3, 1, 1, 30, 1, 2, 65, 180, 'Cook a fresh pot every couple of hours rather than one huge batch. Set limits in your HACCP plan.'),
    (18, 'Paneer Chilli', 'paneer chilli', 'fresh', 'no', 1, false, 'pan', 'Prep tray', 2, 1, 1, 20, 5, 8, null, null, 'Finish fresh for texture.'),
    (19, 'Salad', 'salad', 'assembly', 'no', 1, false, 'cold', 'Cold GN', 2, 1, 1, 10, 2, 3, null, null, 'Keep components cold and portioned.'),
    (20, 'Chicken 65 Biriyani', 'chicken 65 biriyani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN + tray', 2, 1, 1, 75, 6, 8, 65, 120, 'Keep the fried component separate until service.'),
    (21, 'Dessert', 'pudding,payasam', 'batch_portion', 'no', 1, false, 'cold', 'Cold container', 3, 1, 1, 30, 1, 2, null, null, 'Count portions before service.'),
    (22, 'Fried Chicken Biriyani', 'fried chicken biriyani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN + tray', 3, 1, 1, 75, 6, 8, 65, 120, 'Control the rice batch; finish the chicken component to order.'),
    (23, 'Uzhunnuvada', 'uzhunnuvada', 'fresh', 'no', 1, true, 'fryer', 'Freezer tray', 2, 1, 1, 0, 6, 8, null, null, 'Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked.'),
    (24, 'Parippuvada', 'parippuvada,paripuvada', 'fresh', 'no', 1, true, 'fryer', 'Freezer tray', 2, 1, 1, 0, 6, 8, null, null, 'Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked.'),
    (25, 'Pathiri', 'pathiri', 'fresh', 'no', 1, true, 'tawa', 'Freezer tray', 4, 1, 2, 0, 4, 6, null, null, 'Bought frozen: heat on the tawa to order.'),
    (26, 'Chicken Roll', 'chicken roll', 'assembly', 'no', 1, false, 'cold', 'Prep tray', 2, 1, 1, 20, 4, 6, null, null, 'Keep filling and wraps ready; finish to order.')
     ) as v(pos, dish, terms, method, bain, open_pct, frozen, station, container, batch, minp, reorder, prep, finish, wait, hold, maxhold, notes)
where o.name ilike 'kokoland%'
on conflict (org_id, dish) do nothing;

-- ============================================================================
-- 0060 · Partners can see everyone's availability and manage the schedule
--
-- Reported: a partner opening Staff saw only their own availability (one
-- person's Tuesday) while every other row looked empty. Cause: the
-- staff_availability policy from 0042 lets only owner/admin/manager see other
-- people's rows, and shifts (0044) are writable only by those same roles — but
-- partners (who run the restaurant day to day) get the Staff schedule board in
-- the UI, which invites them to click a day and assign a shift.
--
-- 1. Partners can READ all availability. Writing someone else's availability
--    stays with owner/admin/manager (0042's policy is unchanged).
-- 2. Partners can create/edit/delete shifts, like managers.
--
-- Idempotent. The 'partner' role literal is safe here: it was added to the
-- org_role enum back in 0023, in an earlier transaction.
-- ============================================================================

drop policy if exists staff_availability_partner_select on public.staff_availability;
create policy staff_availability_partner_select on public.staff_availability
  for select using (has_org_role(org_id, 'partner'));

drop policy if exists shifts_manager_write on public.shifts;
create policy shifts_manager_write on public.shifts
  for all
  using (has_org_role(org_id, 'owner', 'admin', 'manager', 'partner'))
  with check (has_org_role(org_id, 'owner', 'admin', 'manager', 'partner'));

-- ============================================================================
-- 0061 · Catering menu + spend-tier discounts
--
-- A shareable public page listing every dish, for the customers who ask
-- "can I get a menu for catering." Building an order there doesn't check
-- out like the QR menu does — catering needs a human to confirm date,
-- headcount and logistics — so submitting sends a request the restaurant
-- reviews, the same shape as place_public_reservation already uses for
-- table bookings.
--
-- Spend-tier discounts ("order over €300, get 10% off") live in
-- orgs.settings.cateringTiers, the same catch-all JSON blob category order
-- already uses — no new column needed, and a manager can edit it without a
-- migration. Only that one key is ever exposed to the public route (see
-- publicCateringTiers() in src/lib/api/public.ts), same as
-- publicCategoryOrder() already does for settings.categoryOrder.
-- ============================================================================

create table if not exists public.catering_inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  guest_name text not null,
  phone text not null,
  email text,
  event_date date,
  headcount int,
  notes text,
  -- Snapshot of what they picked and its price at request time — a later
  -- price change on a recipe must not silently reprice a pending request.
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  discount_pct numeric not null default 0,
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists catering_inquiries_org_idx on public.catering_inquiries (org_id, created_at desc);

alter table public.catering_inquiries enable row level security;

drop policy if exists catering_member_read on public.catering_inquiries;
create policy catering_member_read on public.catering_inquiries for select using (is_org_member(org_id));

drop policy if exists catering_member_update on public.catering_inquiries;
create policy catering_member_update on public.catering_inquiries for update using (is_org_member(org_id));

-- No insert policy for anon/authenticated — inserts only ever come through
-- place_catering_inquiry() below, same reasoning as place_public_reservation:
-- a public visitor should be able to submit a request, never read or edit
-- anyone else's.

create or replace function public.place_catering_inquiry(
  _slug text,
  _guest_name text,
  _phone text,
  _email text default null,
  _event_date date default null,
  _headcount int default null,
  _notes text default null,
  _items jsonb default '[]'::jsonb,
  _subtotal numeric default 0,
  _discount_pct numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _id uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if _guest_name is null or length(trim(_guest_name)) = 0 then raise exception 'name is required'; end if;
  if _phone is null or length(trim(_phone)) = 0 then raise exception 'phone is required'; end if;

  insert into catering_inquiries
    (org_id, guest_name, phone, email, event_date, headcount, notes, items, subtotal, discount_pct)
  values
    (_org, trim(_guest_name), trim(_phone), nullif(trim(coalesce(_email, '')), ''), _event_date,
     _headcount, _notes, _items, greatest(_subtotal, 0), greatest(_discount_pct, 0))
  returning id into _id;

  insert into notifications (org_id, type, title, body, ref)
  values (
    _org, 'catering', 'New catering request: ' || trim(_guest_name),
    coalesce(_headcount::text || ' guests · ', '') || '€' || round(_subtotal)::text ||
      case when _discount_pct > 0 then ' (' || _discount_pct::text || '% off)' else '' end,
    'recipes'
  );

  return jsonb_build_object('inquiry_id', _id);
end $$;

grant execute on function public.place_catering_inquiry to anon;

-- Mirrors set_category_order (0054): a manager/partner can edit the
-- discount tiers without the whole orgs row (payment/TSE credentials
-- included) opening up to their write access.
create or replace function public.set_catering_tiers(_org uuid, _tiers jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager', 'partner') then
    raise exception 'not authorized';
  end if;

  update orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{cateringTiers}', _tiers, true)
   where id = _org;
end $$;

grant execute on function public.set_catering_tiers(uuid, jsonb) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.catering_inquiries;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 0062 · One running tab per table for QR orders
--
-- Every QR submission inserted its own order, and never set orders.table_id —
-- the table survived only as free text inside kitchen_notes ("Table: T1."). So
-- one table ordering three times produced three bills (really happened:
-- ORD-0485/0486/0487, all T1, within two minutes), and nothing downstream —
-- Floor, POS, reporting — could group by table at all.
--
-- Now a dine-in QR order looks for an unpaid order already open at that table
-- from this sitting and adds its items to it, and every new order records a
-- real table_id.
--
-- Deliberately NOT tabbed:
--   * takeaway and delivery — each is its own collection, and "Takeaway" is a
--     real row in restaurant_tables, so it is excluded by name as well as by
--     order_type in case a client ever sends the wrong one;
--   * any order carrying a loyalty voucher — a discount is priced against one
--     order's subtotal, and folding a discounted submission into an existing
--     tab would silently re-apply it across the whole bill.
--
-- The six-hour window is what separates "this sitting" from the 73 stale open
-- orders already in the table; those also all have table_id null, so they can
-- never be matched by the lookup below.
-- ============================================================================

create or replace function public.place_public_order(
  _slug text, _items jsonb, _guest_name text default 'Guest',
  _table_name text default null, _notes text default null,
  _email text default null, _code text default null,
  _order_type text default 'dine_in', _address text default null,
  _postcode text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _rate numeric; _subtotal numeric := 0; _tax numeric := 0; _total numeric; _discount numeric := 0;
  _no int; _order_number text; _order_id uuid; _full_items jsonb := '[]'::jsonb;
  _cust uuid; _voucher jsonb; _prog record; _mult numeric := 1; _earn int := 0;
  _delivery_fee numeric := 0; _zone record; grp record; _grp_net numeric;
  it jsonb; r record;
  _table_id uuid; _tab record; _merged jsonb; _idx int; i int; _appended boolean := false; _tab_total numeric;
begin
  select id, tax_rate into _org, _rate from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if jsonb_array_length(_items) = 0 or jsonb_array_length(_items) > 50 then raise exception 'invalid order'; end if;

  for it in select * from jsonb_array_elements(_items) loop
    select id, name, price, tax_rate into r from recipes
      where id = (it->>'recipe_id')::uuid and org_id = _org and is_active = true
        and (sold_out_until is null or sold_out_until <= now())
        and name not ilike '%(Tournament)%'
        and (
          not exists (select 1 from event_menu_items emi where emi.recipe_id = recipes.id)
          or exists (
            select 1 from event_menu_items emi
            join event_menus em on em.id = emi.event_menu_id
            where emi.recipe_id = recipes.id
              and em.org_id = _org and em.is_active = true and em.show_on_website = true
          )
        );
    if not found then raise exception 'item unavailable'; end if;
    _subtotal := _subtotal + r.price * (it->>'qty')::numeric;
    _full_items := _full_items || jsonb_build_object(
      'recipe_id', r.id, 'name', r.name, 'qty', (it->>'qty')::numeric, 'price', r.price,
      'tax_rate', coalesce(r.tax_rate, _rate)
    );
  end loop;

  if _code is not null and length(trim(_code)) > 0 then
    _voucher := loyalty_voucher_value(_org, _code, _subtotal);
    if (_voucher->>'valid')::boolean then _discount := coalesce((_voucher->>'discount')::numeric,0); end if;
  end if;

  -- Delivery: server-computed fee, never trust a client-submitted amount.
  if _order_type = 'delivery' then
    select * into _zone from delivery_zones
      where org_id = _org and is_active = true
        and lower(regexp_replace(postcode, '\s', '', 'g')) = lower(regexp_replace(coalesce(_postcode, ''), '\s', '', 'g'))
      limit 1;
    if not found then raise exception 'we do not deliver to this postcode yet'; end if;
    if _subtotal < _zone.min_order then
      raise exception 'minimum order for delivery to this postcode is %', _zone.min_order;
    end if;
    _delivery_fee := _zone.delivery_fee;
  end if;

  -- VAT extracted per rate group (see checkout_order) — the delivery fee is
  -- added to the total as its own gross line, not re-taxed here.
  for grp in
    select rate, sum(gross) as gross from (
      select coalesce((item.value->>'tax_rate')::numeric, _rate) as rate,
             (item.value->>'price')::numeric * (item.value->>'qty')::numeric as gross
      from jsonb_array_elements(_full_items) item
    ) lines
    group by rate
  loop
    _grp_net := greatest(
      grp.gross - (case when _subtotal > 0 then _discount * grp.gross / _subtotal else 0 end),
      0
    );
    _tax := _tax + round(_grp_net * grp.rate / (100 + grp.rate), 2);
  end loop;

  _total    := round(greatest(_subtotal - _discount, 0) + _delivery_fee, 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  if _email is not null and length(trim(_email)) > 0 then
    select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
    if _cust is null then
      insert into customers (org_id, name, email) values (_org, coalesce(nullif(trim(_guest_name),''),'Guest'), lower(_email)) returning id into _cust;
    end if;
  end if;

  -- The QR code carries a table NAME; everything downstream wants the id.
  if _order_type = 'dine_in' and _table_name is not null and length(trim(_table_name)) > 0 then
    select id into _table_id from restaurant_tables
     where org_id = _org
       and lower(name) = lower(trim(_table_name))
       and lower(name) <> 'takeaway'
     limit 1;
  end if;

  -- An unpaid order already open at this table, from this sitting.
  if _table_id is not null and _discount = 0 then
    select o.id, o.order_number, o.items into _tab
      from orders o
     where o.org_id = _org and o.table_id = _table_id and o.source = 'storefront'
       and o.status = 'open' and o.created_at > now() - interval '6 hours'
     order by o.created_at desc
     limit 1;
    _appended := found;
  end if;

  if _appended then
    -- Fold the new lines into the tab: same dish at the same price bumps its
    -- quantity, anything else joins as a new line. A bumped line loses its
    -- `ready` tick, because the extra portions still have to be cooked.
    _merged := _tab.items;
    for it in select * from jsonb_array_elements(_full_items) loop
      _idx := null;
      for i in 0 .. jsonb_array_length(_merged) - 1 loop
        if _merged->i->>'recipe_id' = it->>'recipe_id'
           and coalesce((_merged->i->>'price')::numeric, 0) = coalesce((it->>'price')::numeric, 0) then
          _idx := i; exit;
        end if;
      end loop;
      if _idx is null then
        _merged := _merged || it;
      else
        _merged := jsonb_set(
          _merged, array[_idx::text],
          (_merged->_idx) - 'ready'
            || jsonb_build_object('qty', (_merged->_idx->>'qty')::numeric + (it->>'qty')::numeric)
        );
      end if;
    end loop;

    update orders set
      items          = _merged,
      subtotal       = subtotal + _subtotal,
      tax            = tax + _tax,
      total          = total + _total,
      -- Food just arrived on a tab the kitchen had finished, so it goes back
      -- on the board rather than sitting silently as ready/served.
      kitchen_status = case when kitchen_status in ('ready','served')
                            then 'preparing'::kitchen_status else kitchen_status end,
      kitchen_notes  = coalesce(kitchen_notes, '') || coalesce(' + ' || nullif(trim(_notes), ''), ''),
      customer_id    = coalesce(customer_id, _cust)
    where id = _tab.id
    returning total into _tab_total;

    _order_id := _tab.id;
    _order_number := _tab.order_number;
  else
    update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
    _order_number := 'ORD-' || lpad(_no::text, 4, '0');

    insert into orders (org_id, order_number, order_type, guest_name, customer_id, table_id, items, subtotal, tax, total, status, kitchen_status, kitchen_notes, source)
    values (_org, _order_number, _order_type::order_type, _guest_name, _cust, _table_id, _full_items, _subtotal, _tax, _total, 'open', 'new',
            coalesce('Table: ' || _table_name || '. ', '') || coalesce(_notes, ''), 'storefront')
    returning id into _order_id;
  end if;

  if _order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, postcode, delivery_fee, status)
    values (_org, _order_id, coalesce(_address, ''), _postcode, _delivery_fee, 'pending');
  end if;

  if _voucher is not null and (_voucher->>'valid')::boolean then
    update loyalty_redemptions set status = 'applied', applied_order_id = _order_id where id = (_voucher->>'redemption_id')::uuid;
  end if;

  if _cust is not null then
    update customers set visits = visits + 1, total_spend = total_spend + _total, last_visit_at = now() where id = _cust;
    select * into _prog from loyalty_programs where org_id = _org;
    if found and _prog.enabled then
      select coalesce((t.perks->>'earn_multiplier')::numeric,1) into _mult
        from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _cust;
      _earn := floor(_total * coalesce(_prog.earn_rate,1) * coalesce(_mult,1))::int;
      if _earn > 0 then
        update customers set points = points + _earn, status_points = status_points + _earn where id = _cust;
        insert into loyalty_transactions (org_id, customer_id, points_delta, reason, order_id, action_type)
          values (_org, _cust, _earn, 'Order ' || _order_number, _order_id, 'purchase');
      end if;
      perform loyalty_recompute_tier(_org, _cust);
    end if;
  end if;

  insert into notifications (org_id, type, title, body, ref)
  values (_org, 'public_order',
          case when _appended then 'Added to ' || _order_number else 'Online order ' || _order_number end,
          _guest_name || coalesce(' at table ' || _table_name, '')
            || case when _appended then ' — more items on the tab' else ' — pay at counter' end,
          'kitchen');

  return jsonb_build_object(
    'order_number', _order_number,
    -- What the whole table now owes, so a second round doesn't show the guest
    -- only that round's price. Loyalty above still earns on _total, which is
    -- the amount actually added.
    'total', case when _appended then _tab_total else _total end,
    'discount', _discount,
    'order_id', _order_id, 'delivery_fee', _delivery_fee, 'appended', _appended
  );
end $$;

grant execute on function public.place_public_order(text,jsonb,text,text,text,text,text,text,text,text) to anon;

-- ============================================================================

-- ============================================================================
-- 0063 · Reconcile QR tabs against the SumUp sale that paid for them
--
-- A guest orders on the QR menu, then pays at the counter on SumUp. That
-- produced two rows for one meal: an open 'storefront' order that nobody ever
-- closed, and a paid 'sumup' order. Revenue counts everything that is not void
-- or refunded, so every QR order was being counted twice — 73 orders and
-- €1,589 of a €10,150 total at the time this was written, about 16%.
--
-- Matching is exact rather than fuzzy, because SumUp's sync already separates
-- the tip into its own column: the food total is (total - tip), and that equals
-- the tab total to the cent. Item names only confirm, and only matter when two
-- tabs happen to share a total.
--
-- The tab is linked, not voided. Void means cancelled, and this food was very
-- much cooked and sold; the SumUp sale is the fiscal record and the tab is the
-- ordering record, so the tab keeps its items and points at the sale that
-- settled it. Anything carrying merged_into is excluded from revenue in the app
-- (see calc.ts / Reports.tsx), and the link can simply be cleared to undo.
-- ============================================================================

alter table public.orders
  add column if not exists merged_into uuid references public.orders(id) on delete set null;

comment on column public.orders.merged_into is
  'Set when this order was settled by another order (a QR tab paid on SumUp). Excluded from revenue; the target order is the financial record.';

create index if not exists orders_merged_into_idx
  on public.orders (merged_into) where merged_into is not null;

-- How much two orders' item lists agree, 0..1, comparing lower-cased names.
-- SumUp's names differ from the menu's only in casing ("Paneer biriyani"),
-- which is exactly what this is meant to see through.
create or replace function public.order_items_overlap(_a jsonb, _b jsonb)
returns numeric language sql immutable set search_path = public as $$
  with a as (select distinct lower(trim(value->>'name')) as n from jsonb_array_elements(coalesce(_a, '[]'::jsonb))),
       b as (select distinct lower(trim(value->>'name')) as n from jsonb_array_elements(coalesce(_b, '[]'::jsonb))),
       hits as (select count(*)::numeric c from a join b using (n)),
       sizes as (select greatest((select count(*) from a), (select count(*) from b), 1)::numeric c)
  select (select c from hits) / (select c from sizes);
$$;

/**
 * Link one SumUp sale to the QR tab it paid for, if exactly one fits.
 *
 * Conservative on purpose: a wrong link silently moves money between days, so
 * anything ambiguous is left alone for a human rather than guessed at.
 */
create or replace function public.match_sumup_order(_sale_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _sale record; _food numeric; _n int; _tab uuid; _best numeric; _ties int;
begin
  select * into _sale from orders where id = _sale_id;
  if not found or _sale.source <> 'sumup' or _sale.status in ('void', 'refunded') then return null; end if;

  _food := round(_sale.total - coalesce(_sale.tip, 0), 2);
  if _food <= 0 then return null; end if;

  -- Candidates: unsettled QR tabs for the same money, from around this sale.
  -- One statement rather than a temp table: this runs inside a trigger on
  -- every SumUp insert, and a temp table there is both slower and fussier
  -- (it outlives the call within a transaction, so the backfill loop below
  -- would have to keep clearing it).
  with cand as (
    select o.id, order_items_overlap(o.items, _sale.items) as score
      from orders o
     where o.org_id = _sale.org_id
       and o.source = 'storefront'
       and o.status = 'open'
       and o.merged_into is null
       and o.id <> _sale.id
       and round(o.total, 2) = _food
       and o.created_at between _sale.created_at - interval '8 hours'
                            and _sale.created_at + interval '30 minutes'
  ), agg as (select count(*) as n, coalesce(max(score), 0) as best from cand)
  select c.id, a.n, a.best, (select count(*) from cand where score >= a.best - 0.01)
    into _tab, _n, _best, _ties
    from cand c cross join agg a
   order by c.score desc, c.id
   limit 1;

  if coalesce(_n, 0) = 0 then return null; end if;

  -- Same total on two tabs: let the item names break the tie, and only when
  -- one is clearly better. Otherwise leave both for someone to look at.
  if _n > 1 and (_ties > 1 or _best < 0.5) then return null; end if;

  update orders
     set merged_into = _sale.id,
         status = 'paid',
         kitchen_status = case when kitchen_status = 'served' then kitchen_status else 'served'::kitchen_status end
   where id = _tab;

  return _tab;
end $$;

-- Match on the way in, so a sale synced by cron or accepted by hand both land
-- here without the sync code having to remember to call it.
create or replace function public.trg_match_sumup_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'sumup' and new.status not in ('void', 'refunded') then
    perform match_sumup_order(new.id);
  end if;
  return new;
end $$;

drop trigger if exists orders_match_sumup on public.orders;
create trigger orders_match_sumup
  after insert on public.orders
  for each row execute function public.trg_match_sumup_order();

-- ---------------------------------------------------------------------------
-- Backfill: settle the tabs already sitting open against sales already synced.
-- Same conservative rule, so ambiguous pairs stay untouched and visible.
-- ---------------------------------------------------------------------------
do $$
declare s record;
begin
  for s in
    select id from orders
     where source = 'sumup' and status not in ('void', 'refunded')
     order by created_at
  loop
    perform match_sumup_order(s.id);
  end loop;
end $$;

-- ============================================================================
-- 0065 · Backfill org.settings.enabled_modules for kitchenops/dailytasks
--
-- kitchenops and dailytasks are staying on ALWAYS_ENABLED_MODULES in most
-- respects, but that frontend list is being trimmed so their Settings pill
-- stops being locked "(core)" — i.e. an owner can genuinely turn either off
-- per org, like almost every other module.
--
-- Confirmed live: both real orgs (Kokoland Berlin, Big Brewsky) have an
-- EXPLICIT settings.enabled_modules array that predates these two module ids
-- (added earlier today) — neither array contains them. Without this backfill,
-- removing the ALWAYS_ENABLED_MODULES bypass would immediately hide both
-- features for every existing org, the exact failure mode that constant
-- exists to prevent in the first place.
--
-- Only touches orgs with an explicit array (missing the key already means
-- "every module", so there's nothing to add). Idempotent — re-running just
-- re-confirms membership, dedup via array_agg(distinct ...).
-- ============================================================================

update public.orgs
set settings = jsonb_set(
  settings,
  '{enabled_modules}',
  (
    select to_jsonb(array_agg(distinct m))
    from jsonb_array_elements_text(settings->'enabled_modules' || '["kitchenops","dailytasks"]'::jsonb) as m
  )
)
where settings ? 'enabled_modules'
  and not (
    settings->'enabled_modules' @> '["kitchenops"]'
    and settings->'enabled_modules' @> '["dailytasks"]'
  );

-- ============================================================================
-- 0064 · Make SumUp↔tab matching reliable for new orders
--
-- 0063's backfill linked 16 of 73 historical tabs. Reviewing the misses showed
-- the rule was right to refuse most of them (21 had a same-total sale a median
-- of 48 hours away — coincidence, not the same meal), but it also refused at
-- least one obvious pair: a tab at 17:21 and a sale at 17:20, same total, same
-- "Paneer Biriyani" on both sides, rejected only because a sibling tab shared
-- the total and the tie-break gave up.
--
-- Two changes, both aimed at orders placed from here on:
--
-- 1. Anchor on the tab's LAST ACTIVITY, not when it was opened. Now that a
--    table builds one running tab (0062), a party may open at 18:00, add a
--    round at 19:30 and pay at 19:40 — ten minutes after the last thing they
--    ordered, but nearly two hours after the tab began. updated_at is
--    maintained by the set_updated_at trigger, so it tracks the last round.
--
-- 2. Break ties on time proximity before giving up. Two tabs with the same
--    total is common (€13.50 is a popular bill); two tabs with the same total
--    *within a couple of minutes of the same payment* is not. Only genuinely
--    indistinguishable pairs — alike on both name overlap and timing — are
--    still left for a human.
--
-- The window also tightens from -8h/+30m to -30m/+4h around last activity,
-- because payment follows the last round rather than preceding the first. That
-- alone removes most of the coincidental candidates that caused the ties.
-- ============================================================================

create or replace function public.match_sumup_order(_sale_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _sale record; _food numeric;
  _n int; _tab uuid; _best numeric; _best_gap numeric; _ties int;
begin
  select * into _sale from orders where id = _sale_id;
  if not found or _sale.source <> 'sumup' or _sale.status in ('void', 'refunded') then return null; end if;

  _food := round(_sale.total - coalesce(_sale.tip, 0), 2);
  if _food <= 0 then return null; end if;

  with cand as (
    select o.id,
           order_items_overlap(o.items, _sale.items) as score,
           -- Minutes between the sale and the last time anything was added to
           -- the tab; the real pair is normally single digits.
           abs(extract(epoch from (_sale.created_at - greatest(o.created_at, o.updated_at))) / 60) as gap
      from orders o
     where o.org_id = _sale.org_id
       and o.source = 'storefront'
       and o.status = 'open'
       and o.merged_into is null
       and o.id <> _sale.id
       and round(o.total, 2) = _food
       and greatest(o.created_at, o.updated_at)
             between _sale.created_at - interval '4 hours'
                 and _sale.created_at + interval '30 minutes'
  ), ranked as (
    select c.*, row_number() over (order by c.score desc, c.gap asc) as rn from cand c
  )
  select r.id, (select count(*) from cand), r.score, r.gap,
         -- Rivals that are just as good on BOTH signals: same name overlap and
         -- within two minutes of the same distance from the payment.
         (select count(*) from ranked x
           where x.score >= r.score - 0.01 and abs(x.gap - r.gap) <= 2)
    into _tab, _n, _best, _best_gap, _ties
    from ranked r
   where r.rn = 1;

  if coalesce(_n, 0) = 0 then return null; end if;

  -- Evidence, not coincidence. Being the only candidate is NOT enough on its
  -- own: tested against real history, that alone would have linked a tab to a
  -- sale 71 minutes away with no item name in common. So the names have to
  -- agree — unless payment landed within five minutes of the last round and at
  -- least one item still matches, which is compelling even when SumUp spells
  -- things differently ("Water 0,5lr" against "Water Bottle Small").
  if not (_best >= 0.34 or (_best_gap <= 5 and _best > 0)) then return null; end if;

  -- Rivals alike on both signals stay for a human.
  if _n > 1 and _ties > 1 then return null; end if;

  update orders
     set merged_into = _sale.id,
         status = 'paid',
         kitchen_status = 'served'::kitchen_status
   where id = _tab;

  return _tab;
end $$;

-- ============================================================================
-- 0065 · The catering catalogue, readable by an anonymous visitor
--
-- The catering page is meant to list everything the kitchen can cook for an
-- event, not just what happens to be on today's menu — a dish hidden this week,
-- or sold out this evening, says nothing about a party three weeks out. For
-- Kokoland that is 98 dishes rather than 40.
--
-- The app asked for them and silently got 40 anyway, because anon reads of
-- `recipes` are policy-limited to active rows:
--     recipes_public_read ... for select to anon using (is_active = true)
--
-- That policy is not the thing to relax. It guards every anonymous read of the
-- table, so opening it to `using (true)` would publish every retired and
-- unreleased dish — and its price — to anyone querying the API, for the sake of
-- one page. Instead this is a narrow security-definer view of exactly the
-- catering catalogue, the same approach place_public_order and
-- place_catering_inquiry already take: the broad table policy stays shut and
-- one specific question gets a specific answer.
--
-- Tournament items are still excluded, by name and by event-menu membership —
-- they are priced for an event and sold only at it.
-- ============================================================================

create or replace function public.catering_menu(_slug text)
returns setof public.recipes
language sql stable security definer set search_path = public as $$
  select r.*
    from recipes r
    join orgs o on o.id = r.org_id
   where o.slug = _slug
     and not r.hide_from_catering
     and r.name not ilike '%(Tournament)%'
     and not exists (
       select 1 from event_menu_items emi where emi.recipe_id = r.id
     )
   order by r.category, r.name;
$$;

grant execute on function public.catering_menu(text) to anon, authenticated;

-- ============================================================================
-- 0066 · Backfill missing modules rows (till, payroll)
--
-- 0061_backfill_new_module_access.sql failed live with:
--   insert or update on table "member_module_access" violates foreign key
--   constraint "member_module_access_module_id_fkey"
--   DETAIL: Key (module_id)=(till) is not present in table "modules".
--
-- Confirmed by diffing the live `modules` table against src/lib/modules.ts:
-- 'till' (from an early setup.sql seed block) and 'payroll' (from 0014) were
-- never actually inserted on this database, even though both are referenced
-- by default_modules_for_role() and by the frontend module registry. This
-- database's migration history has gaps from being applied piecemeal rather
-- than as one full ordered replay — this patches the specific gap blocking
-- 0061. Idempotent; safe to re-run.
-- ============================================================================

insert into public.modules (id, name, grouping, sort)
values
  ('till', 'Till & Cash', 'Money', 15),
  ('payroll', 'Payroll', 'People', 23)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- ============================================================================
-- 0067 · Split "helper" out as its own duty, on both sides
--
-- Commi / Kitchen Helper was one duty. The user wants Commi and Kitchen
-- Helper as separate duties (different skill level), plus a mirrored
-- Frontend Helper duty for the front-of-house side — not staffed yet, but
-- available for when it gets busier.
--
-- IMPORTANT: run this file ALONE, in its own "Run". Postgres won't let a new
-- enum value be used in the same transaction that adds it — pasting this
-- together with anything that references 'kitchen_helper'/'frontend_helper'
-- (e.g. inserting a duty_assignments row) would fail with "unsafe use of new
-- value of enum type". This file only extends the enum; nothing else needs
-- to change on the database side — duty_assignments.duty and
-- tasks.assigned_role already accept any staff_role value.
-- ============================================================================

alter type public.staff_role add value if not exists 'kitchen_helper';
alter type public.staff_role add value if not exists 'frontend_helper';
