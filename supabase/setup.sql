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
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport']
    when 'staff' then array['dashboard','myday','pos','kitchen','floor','timeclock','tasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','insights']
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
  cost numeric not null default 0
);

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

-- PO delivered → stock in + notification
create or replace function public.on_po_delivered()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    for r in select * from purchase_order_items where po_id = new.id and inventory_item_id is not null loop
      update inventory_items set stock = stock + r.qty where id = r.inventory_item_id;
      insert into inventory_transactions (org_id, item_id, item_name, delta, reason, note)
      values (new.org_id, r.inventory_item_id, r.name, r.qty, 'purchase', 'PO ' || new.po_number);
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
  update invites set accepted_at = now(), accepted_by = auth.uid() where id = _inv.id;
  update profiles set active_org_id = _inv.org_id where id = auth.uid() and active_org_id is null;
  return _inv.org_id;
end $$;

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
  ('channels','Delivery Channels','Operate',23)
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
-- 15. DELIVERY CHANNELS (Uber Eats / Wolt / Lieferando) — see 0026
-- ----------------------------------------------------------------------------
do $$ begin create type channel_provider as enum ('ubereats','wolt','lieferando');
exception when duplicate_object then null; end $$;

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
create or replace function public.accept_channel_order(
  _channel_order uuid,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  co record; ch record; it jsonb;
  _gross numeric := 0; _tax numeric; _subtotal numeric; _rate numeric;
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

  -- Trust the platform's line prices — that is what the guest actually paid.
  for it in select * from jsonb_array_elements(co.items) loop
    _gross := _gross + (it->>'price')::numeric * (it->>'qty')::numeric;
  end loop;
  -- Fall back to the payload's own total if the lines did not carry prices.
  if _gross = 0 then _gross := co.gross; end if;

  -- VAT-included (gross) pricing, matching checkout_order (0017/0025).
  _tax := round(_gross * _rate / (100 + _rate), 2);
  _subtotal := round(_gross - _tax, 2);

  update orgs set next_order_no = next_order_no + 1
    where id = co.org_id returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  -- Strip our internal recipe_id resolution out of the stored line items so
  -- `orders.items` keeps the same shape POS writes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', it.value->>'recipe_id',
           'name', it.value->>'name',
           'qty', (it.value->>'qty')::numeric,
           'price', (it.value->>'price')::numeric
         )), '[]'::jsonb)
    into _items
    from jsonb_array_elements(co.items) it;

  insert into orders (
    org_id, order_number, order_type, customer_id, guest_name, items,
    subtotal, tax, tip, total, discount, status, kitchen_status, kitchen_notes, source
  ) values (
    co.org_id, _order_number, co.order_type, null,
    nullif(co.customer_name, ''), _items,
    _subtotal, _tax, 0, round(_gross, 2), 0,
    'paid',                                    -- the platform already collected
    case when ch.send_to_kitchen then 'new'::kitchen_status else 'served'::kitchen_status end,
    co.notes, co.provider::text
  ) returning id into _order_id;

  -- Payout leg so takings/Z-report reconcile (see header note on 'wallet').
  insert into payments (org_id, order_id, method, amount, tip_amount, split_label)
  values (co.org_id, _order_id, 'wallet', round(_gross, 2), 0, co.provider::text);

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

  update channels set last_order_at = now(), last_error = null where id = co.channel_id;

  return jsonb_build_object(
    'order_id', _order_id, 'order_number', _order_number,
    'total', round(_gross, 2), 'already_decided', false
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
values ('channels', 'Delivery Channels', 'Operate', 12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

insert into public.modules (id, name, grouping, sort)
values ('channels', 'Delivery Channels', 'Operate', 23)
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
