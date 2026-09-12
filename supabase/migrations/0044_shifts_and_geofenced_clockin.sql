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
