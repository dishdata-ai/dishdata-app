-- ============================================================================
-- 0023 — Partner Hub
-- New `partner` org role + partner task space (hidden from employees at the
-- RLS level), effort points, task categories, partner skill profiles, kudos.
--
-- NOTE: a new enum value cannot be referenced as an enum LITERAL in the same
-- transaction that added it (the SQL editor runs this file as one transaction),
-- so every 'partner' comparison below goes through role::text.
-- ============================================================================

alter type org_role add value if not exists 'partner';

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
-- Partner-space visibility: owners, admins and partners.
create or replace function public.can_see_partner_tasks(_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = _org and user_id = auth.uid()
      and role::text in ('owner','admin','partner')
  );
$$;

-- Default module grants per role (mirror of src/lib/modules.ts).
-- Rewritten over _role::text so the fresh 'partner' value is usable pre-commit.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
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

-- ----------------------------------------------------------------------------
-- Tasks: partner space + effort + category
-- ----------------------------------------------------------------------------
alter table public.tasks add column if not exists is_partner_task boolean not null default false;
alter table public.tasks add column if not exists assignee_user_id uuid references auth.users(id) on delete set null;
alter table public.tasks add column if not exists effort integer not null default 1;
alter table public.tasks add column if not exists category text;

-- Partner-aware RLS (replaces the generic member policies from the template loop)
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

-- ----------------------------------------------------------------------------
-- Partner skill profiles (skills directory on the Partner Hub)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Kudos (peer recognition between partners)
-- ----------------------------------------------------------------------------
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
