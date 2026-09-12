-- ============================================================================
-- 0046 · Auto-link an employee record when someone accepts an invite
--
-- My Day and the Staff module ("employees" table) were never connected to
-- Team & Access ("org_members", created by accept_invite()) — accepting an
-- invite only ever created the login/role row. Nothing created a matching
-- employees row, so every new joiner landed on My Day's "Who are you?"
-- self-link picker instead of their own page, and stayed invisible there
-- entirely until they did (confirmed: a just-joined member's name wasn't in
-- the picker at all — there was no employees row for them yet, unlinked or
-- otherwise).
--
-- Same gap exists in create_organization() for a brand-new owner, who
-- doesn't go through accept_invite() at all.
--
-- Three parts, same shape as 0041's module-access backfill: extend
-- accept_invite() and create_organization() so this never happens for a
-- new joiner/owner again, and a one-time backfill for everyone who already
-- joined before this existed.
-- ============================================================================

create or replace function public.accept_invite(_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into _inv from invites where code = _code and accepted_at is null and expires_at > now();
  if not found then raise exception 'Invite is invalid or has expired'; end if;

  insert into org_members (org_id, user_id, role) values (_inv.org_id, auth.uid(), _inv.role)
  on conflict (org_id, user_id) do nothing;

  -- Auto-create + link this member's employee record so My Day works the
  -- moment they join — see header. Skipped if they already have one in this
  -- org (e.g. a manager pre-created their row before the invite was sent).
  insert into employees (org_id, user_id, name, role_title)
  select _inv.org_id, auth.uid(),
    coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'New teammate'),
    initcap(_inv.role::text)
  from profiles p
  where p.id = auth.uid()
    and not exists (select 1 from employees e where e.org_id = _inv.org_id and e.user_id = auth.uid());

  update invites set accepted_at = now(), accepted_by = auth.uid() where id = _inv.id;
  update profiles set active_org_id = _inv.org_id where id = auth.uid() and active_org_id is null;
  return _inv.org_id;
end $$;

create or replace function public.create_organization(_name text, _currency text default 'USD', _tax_rate numeric default 8.5)
returns uuid language plpgsql security definer set search_path = public as $$
declare _org uuid; _slug text; _n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  _slug := regexp_replace(lower(trim(_name)), '[^a-z0-9]+', '-', 'g');
  _slug := trim(both '-' from _slug);
  if _slug = '' then _slug := 'restaurant'; end if;
  while exists (select 1 from orgs where slug = _slug || case when _n > 0 then '-' || _n else '' end) loop
    _n := _n + 1;
  end loop;
  if _n > 0 then _slug := _slug || '-' || _n; end if;

  insert into orgs (name, slug, currency, tax_rate) values (_name, _slug, _currency, _tax_rate) returning id into _org;
  insert into org_members (org_id, user_id, role) values (_org, auth.uid(), 'owner');

  -- Same auto-link as accept_invite() above — a fresh org's owner shouldn't
  -- hit their own "who are you?" picker on My Day either.
  insert into employees (org_id, user_id, name, role_title)
  select _org, auth.uid(), coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Owner'), 'Owner'
  from profiles p where p.id = auth.uid();

  update profiles set active_org_id = _org where id = auth.uid();
  return _org;
end $$;

-- One-time backfill: every existing member with no linked employee row yet.
insert into public.employees (org_id, user_id, name, role_title)
select om.org_id, om.user_id,
  coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1), 'Team member'),
  initcap(om.role::text)
from public.org_members om
join public.profiles p on p.id = om.user_id
where not exists (
  select 1 from public.employees e where e.org_id = om.org_id and e.user_id = om.user_id
);
