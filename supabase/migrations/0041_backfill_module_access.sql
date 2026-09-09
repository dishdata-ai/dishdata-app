-- ============================================================================
-- 0041 · Backfill member module access + keep it from happening again
--
-- member_module_access only ever gets written by grant_default_modules(),
-- which fires `after insert on org_members` — i.e. only when someone joins.
-- Every module shipped after that member's row was created (channels, till,
-- and whatever comes next) simply has no row for them, ever, until someone
-- manually re-grants it in Team & Access. Confirmed live: 9 of Kokoland's 10
-- members had no `channels` row, all 10 had no `till` row — including the
-- owner, who should see everything.
--
-- Two parts: a one-time backfill for the gap that already exists, and a
-- trigger so a module added from here on grants itself to every existing
-- member whose role would get it by default — the same thing
-- grant_default_modules() already does for a brand-new member, just fired
-- from the other direction (a new module arriving) instead of only a new
-- member arriving.
-- ============================================================================

-- One-time backfill: every existing member, every module their role default
-- already includes, wherever the row is missing. on conflict do nothing means
-- this only ever fills gaps — it can't touch a right someone was deliberately
-- given or an access an admin deliberately revoked.
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, m, true
from public.org_members om, unnest(public.default_modules_for_role(om.role)) as m
on conflict (org_id, user_id, module_id) do nothing;

-- Going forward: when a genuinely new module row is inserted, grant it to
-- every existing member whose role default includes it. Reusing setup.sql's
-- module seed as `on conflict (id) do update` means this only fires for a
-- module that's actually new, never on the routine re-run that keeps
-- existing modules' name/grouping/sort in sync.
create or replace function public.grant_new_module_to_existing_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into member_module_access (org_id, user_id, module_id, can_access)
  select om.org_id, om.user_id, new.id, true
  from org_members om
  where new.id = any(default_modules_for_role(om.role))
  on conflict (org_id, user_id, module_id) do nothing;
  return new;
end $$;

drop trigger if exists on_module_added on public.modules;
create trigger on_module_added after insert on public.modules
  for each row execute function public.grant_new_module_to_existing_members();
