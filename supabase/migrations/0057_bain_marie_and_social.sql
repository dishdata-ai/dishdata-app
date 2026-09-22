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
