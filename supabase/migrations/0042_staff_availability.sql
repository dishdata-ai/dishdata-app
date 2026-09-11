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
