-- ============================================================================
-- 0036 · Event preorders + timeslot capacity
-- A reusable module for campaigns like Kokoland's Onam Sadhya: a named event
-- with configurable service dates, an hourly slot grid and a per-slot dine-in
-- capacity, plus the preorders placed against it (staff-entered, CSV-imported,
-- or pushed in by the WordPress/Forminator form via webhook).
--
-- Distinct from `reservations` (0001), which books a specific TABLE for a
-- specific time. Here capacity is a per-hour cover count for a whole service,
-- and orders carry a dish quantity + money, which reservations do not.
--
-- fulfillment_type reuses the existing `order_type` enum rather than adding a
-- new one — a fresh enum value can't be used as a literal in the same
-- transaction that created it, and the SQL editor runs this file as one.
-- ============================================================================

create table if not exists public.preorder_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  -- The days this event actually serves. Drives the date tabs, so a date with
  -- zero orders still shows up (staff need to see an empty service coming).
  service_dates date[] not null default '{}',
  slot_minutes integer not null default 60,
  day_start_hour integer not null default 11,
  day_end_hour integer not null default 22,  -- exclusive: 11..22 = 11 slots
  dine_in_capacity integer not null default 20,  -- covers per slot
  -- Per-event shared secret so a new event can be wired to the website form
  -- without adding an env var. Same generator as invites.code (0001).
  webhook_secret text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table if not exists public.preorder_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id uuid not null references public.preorder_events(id) on delete cascade,
  -- Dedupe key: the form's submission id (webhook) or a hash of the row
  -- (CSV import). NULL for staff-entered phone orders, which have no natural
  -- external id and must never collide with each other.
  external_id text,
  customer_name text not null default '',
  customer_email text,
  customer_phone text,
  requested_date date not null,
  quantity integer not null default 1,          -- sadhyas ordered = covers
  fulfillment_type order_type not null default 'takeaway',
  -- Real clock times, not a slot index: the UI only ever creates hour-aligned
  -- bookings, but a time negotiated by phone (e.g. 11:30–12:30) must survive
  -- as promised rather than being silently rounded onto the grid.
  -- NULL start = not yet placed. For takeaway, start is the pickup time and
  -- end stays NULL (takeaway occupies no seats).
  timeslot_start time,
  timeslot_end time,
  address_street text,
  address_apartment text,
  address_city text,
  address_zip text,
  addon_qty integer not null default 0,         -- "Real Leaf" addon
  special_requests text,
  order_total numeric not null default 0,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled')),
  raw jsonb not null default '{}'::jsonb,       -- original payload, for audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists preorder_orders_org_event_idx
  on public.preorder_orders (org_id, event_id);
create index if not exists preorder_orders_event_date_idx
  on public.preorder_orders (event_id, requested_date);
-- Upsert target that makes webhook delivery and CSV re-imports idempotent.
-- Partial, so the NULL external_id of manual orders never conflicts.
create unique index if not exists preorder_orders_event_external_uidx
  on public.preorder_orders (event_id, external_id) where external_id is not null;

-- updated_at + created_by + RLS, reusing the array-driven pattern from 0016.
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
