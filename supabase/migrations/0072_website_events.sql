-- ============================================================================
-- 0072 · Website events
--
-- The "What's on" section of the public website (kokoland-next-berlin) reads
-- from this table; managers add and publish events in Marketing → Events.
-- Anonymous visitors can read published events only (a plain row filter, same
-- reasoning as blog_posts and recipes_public_read), so no RPC is needed.
--
-- Not to be confused with preorder_events, which are the pre-order service
-- days used by the Preorders module.
-- ============================================================================

create table if not exists public.website_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  description text,
  event_date date not null,
  -- Free text such as "19:00" or "from 19:00": it is only displayed.
  event_time text,
  -- Short badge shown next to the title, e.g. "Live" or "Halloween".
  tag text,
  -- Optional "more info / tickets" link; the website falls back to its booking form.
  cta_url text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists website_events_org_idx on public.website_events (org_id, event_date);

drop trigger if exists website_events_updated_at on public.website_events;
create trigger website_events_updated_at before update on public.website_events
  for each row execute function public.set_updated_at();

alter table public.website_events enable row level security;

drop policy if exists website_events_member_read on public.website_events;
create policy website_events_member_read on public.website_events for select using (is_org_member(org_id));

drop policy if exists website_events_manage on public.website_events;
create policy website_events_manage on public.website_events for all
  using (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'))
  with check (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'));

drop policy if exists website_events_public_read on public.website_events;
create policy website_events_public_read on public.website_events for select to anon
  using (status = 'published');

-- Kokoland Berlin's first real event. Further dates are added in the app.
insert into public.website_events (org_id, title, description, event_date, tag, status)
select o.id, 'Halloween at kokoland',
       'A Halloween-themed night at kokoland. More details coming soon.',
       date '2026-10-31', 'Halloween', 'published'
from public.orgs o
where o.slug = 'kokoland-berlin'
  and not exists (
    select 1 from public.website_events e where e.org_id = o.id and e.event_date = date '2026-10-31'
  );
