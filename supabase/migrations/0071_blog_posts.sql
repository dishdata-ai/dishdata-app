-- ============================================================================
-- 0071 · Blog posts
--
-- The public website (kokoland-next-berlin) renders /blog from this table;
-- partners write and publish posts in Marketing → Blog. Posts are per-org, so
-- each future city gets its own blog under the same domain.
--
-- Anonymous visitors can read only published posts whose publish time has
-- passed (a plain row filter, the same reasoning as recipes_public_read), so
-- no RPC is needed. Drafts and scheduled posts stay members-only.
-- ============================================================================

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  slug text not null,
  title text not null,
  excerpt text,
  body_md text not null default '',
  cover_url text,
  lang text not null default 'en' check (lang in ('de', 'en')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create index if not exists blog_posts_org_idx on public.blog_posts (org_id, status, published_at desc);

drop trigger if exists blog_posts_updated_at on public.blog_posts;
create trigger blog_posts_updated_at before update on public.blog_posts
  for each row execute function public.set_updated_at();

alter table public.blog_posts enable row level security;

drop policy if exists blog_posts_member_read on public.blog_posts;
create policy blog_posts_member_read on public.blog_posts for select using (is_org_member(org_id));

drop policy if exists blog_posts_manage on public.blog_posts;
create policy blog_posts_manage on public.blog_posts for all
  using (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'))
  with check (has_org_role(org_id, 'owner', 'admin', 'partner', 'manager'));

drop policy if exists blog_posts_public_read on public.blog_posts;
create policy blog_posts_public_read on public.blog_posts for select to anon
  using (status = 'published' and published_at is not null and published_at <= now());
