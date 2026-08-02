-- ============================================================================
-- 0024 — Task details (Asana-style)
-- Subtask checklists, attached links, and per-task comment threads.
-- Comment visibility mirrors task visibility, so partner-task discussions
-- stay hidden from employees at the RLS level.
-- ============================================================================

alter table public.tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.tasks add column if not exists links jsonb not null default '[]'::jsonb;

-- Can the current user see this task at all? (org member + partner-space rules)
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
