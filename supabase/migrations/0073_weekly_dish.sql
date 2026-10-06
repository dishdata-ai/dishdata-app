-- ============================================================================
-- 0073 · Dish of the week
--
-- Kokoland's menu rotates every week and the public website's menu page puts
-- one live dish in the spotlight with the story behind it. Managers plan it in
-- Marketing → Dish of the week: pick a dish from the live recipes, add a
-- headline, the region and the story. A week runs seven days from starts_on,
-- so it can be written ahead of time.
--
-- Anonymous visitors can read only the week that is running now (Berlin date),
-- so next week's plan stays private until it begins. The dish itself is read
-- through the normal recipes policy, so a dish that is no longer live simply
-- drops out of the page.
-- ============================================================================

create table if not exists public.weekly_dish (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  starts_on date not null,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  -- One punchy line shown big, e.g. "Sunday biryani, the Malabar way".
  headline text,
  -- Where in Kerala it comes from, e.g. "Malabar" or "Travancore".
  region text,
  -- The story behind the dish; blank lines separate paragraphs.
  story text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, starts_on)
);

create index if not exists weekly_dish_org_idx on public.weekly_dish (org_id, starts_on);

drop trigger if exists weekly_dish_updated_at on public.weekly_dish;
create trigger weekly_dish_updated_at before update on public.weekly_dish
  for each row execute function public.set_updated_at();

alter table public.weekly_dish enable row level security;

drop policy if exists weekly_dish_member_read on public.weekly_dish;
create policy weekly_dish_member_read on public.weekly_dish for select using (is_org_member(org_id));

drop policy if exists weekly_dish_manage on public.weekly_dish;
create policy weekly_dish_manage on public.weekly_dish for all
  using (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'))
  with check (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'));

drop policy if exists weekly_dish_public_read on public.weekly_dish;
create policy weekly_dish_public_read on public.weekly_dish for select to anon
  using (
    starts_on <= (now() at time zone 'Europe/Berlin')::date
    and (now() at time zone 'Europe/Berlin')::date < starts_on + 7
  );
