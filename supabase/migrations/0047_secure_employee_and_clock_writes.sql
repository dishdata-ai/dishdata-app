-- ============================================================================
-- 0047 · Lock down employees and time_entries writes
--
-- Both tables have been sitting on the generic "any org member may
-- select/insert/update" template since day one. That template is fine for
-- things like vendors or inventory; it is wrong here, and has been wrong the
-- whole time:
--
--   - `employees` holds `hourly_rate` and `pin`. Any signed-in member — a
--     part-time server included — could `select * from employees` directly
--     via the API and see every coworker's pay and PIN. The UI hides these
--     columns in a couple of places (Time Clock's canSeeWages), but that was
--     never enforced server-side, so it was cosmetic only.
--   - Worse, the same broad policy let ANY member `update` ANY employee row
--     — hourly_rate, pin, is_active, role_title, not just their own — with
--     nothing checking whose row it was.
--   - `time_entries` had the identical problem: any member could insert or
--     update any employee's clock entries directly, with no server-side
--     invariant stopping them from backdating a clock_in, zeroing out
--     break_seconds, or editing an already-closed shift.
--
-- employees: select narrows to manager+ (who legitimately need the whole
-- roster) plus your own row plus any still-unclaimed row (name/role/avatar
-- only in spirit, but Postgres RLS is row- not column-level — this is the
-- accepted trade-off, see the "Who are you?" picker in MyDay, which needs to
-- see unclaimed rows to work at all). Insert/update narrow to manager+,
-- full stop — self-linking moves to claim_employee() below instead of a
-- direct client update, so it keeps working with no update policy needed
-- for plain members at all.
--
-- time_entries: the SHARED TIME CLOCK TABLET is intentionally allowed to
-- clock any employee in or out from one shared device (see timeclock module
-- defaults) — that is a deliberate feature, not the bug. What was actually
-- wrong is that this happened via bare, unconstrained table writes. Writes
-- now go exclusively through record_clock_in/record_clock_out/
-- record_toggle_break, which carry the same invariants clock_in()/clock_out()
-- always assumed but never enforced (one open entry, can't re-close a closed
-- one, breaks compute from real elapsed time). No insert/update policy is
-- created for time_entries at all — RLS default-denies both, exactly like
-- till_sessions/cash_movements (0040) already do for the same reason. Select
-- is left as org-member-readable: seeing when a coworker clocked in isn't
-- the sensitive part, editing it was.
-- ============================================================================

-- ---- employees --------------------------------------------------------------

drop policy if exists employees_member_select on public.employees;
create policy employees_member_select on public.employees
  for select using (
    is_org_member(org_id)
    and (
      has_org_role(org_id, 'owner', 'admin', 'manager', 'partner')
      or user_id = auth.uid()
      or user_id is null
    )
  );

drop policy if exists employees_member_insert on public.employees;
create policy employees_member_insert on public.employees
  for insert with check (has_org_role(org_id, 'owner', 'admin', 'manager'));

drop policy if exists employees_member_update on public.employees;
create policy employees_member_update on public.employees
  for update using (has_org_role(org_id, 'owner', 'admin', 'manager'));

-- employees_manager_delete already requires owner/admin/manager — untouched.

-- Self-service "this is me" claim, moved server-side so plain members need no
-- update grant on employees at all. Unlinks any previous claim by this user
-- first, then claims the target ONLY if it's still unclaimed — guarded here,
-- not just in the picker UI, so a race between two people clicking the same
-- unclaimed name can never let one steal a profile the other just claimed.
create or replace function public.claim_employee(_org uuid, _employee uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  update employees set user_id = null where org_id = _org and user_id = auth.uid();

  update employees set user_id = auth.uid()
   where id = _employee and org_id = _org and user_id is null;

  if not found then
    raise exception 'That profile is already linked to another account.';
  end if;
end $$;

grant execute on function public.claim_employee(uuid, uuid) to authenticated;

-- ---- time_entries -------------------------------------------------------

drop policy if exists time_entries_member_insert on public.time_entries;
drop policy if exists time_entries_member_update on public.time_entries;
-- No replacement insert/update policy — see header. Select and
-- time_entries_manager_delete are untouched.

create or replace function public.record_clock_in(
  _org uuid,
  _employee uuid,
  _lat numeric default null,
  _lng numeric default null,
  _distance_m numeric default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if not exists (select 1 from employees where id = _employee and org_id = _org) then
    raise exception 'employee not found';
  end if;

  insert into time_entries (org_id, employee_id, clock_in_lat, clock_in_lng, clock_in_distance_m)
  values (_org, _employee, _lat, _lng, _distance_m)
  returning id into _id;
  return _id;
exception when unique_violation then
  raise exception 'Already clocked in';
end $$;

create or replace function public.record_clock_out(
  _org uuid,
  _entry uuid,
  _lat numeric default null,
  _lng numeric default null,
  _auto boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare e public.time_entries;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  select * into e from time_entries where id = _entry and org_id = _org;
  if not found then raise exception 'time entry not found'; end if;
  if e.clock_out is not null then raise exception 'already clocked out'; end if;

  update time_entries set
    clock_out = now(),
    -- Close any still-running break, computed from real elapsed time rather
    -- than trusting a client-supplied duration.
    break_seconds = e.break_seconds + case
      when e.break_started_at is not null
      then greatest(0, extract(epoch from (now() - e.break_started_at))::int)
      else 0
    end,
    break_started_at = null,
    clock_out_lat = coalesce(_lat, clock_out_lat),
    clock_out_lng = coalesce(_lng, clock_out_lng),
    auto_clock_out = auto_clock_out or _auto
  where id = _entry;
end $$;

create or replace function public.record_toggle_break(_org uuid, _entry uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.time_entries;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  select * into e from time_entries where id = _entry and org_id = _org;
  if not found then raise exception 'time entry not found'; end if;
  if e.clock_out is not null then raise exception 'already clocked out'; end if;

  if e.break_started_at is not null then
    update time_entries set
      break_seconds = e.break_seconds + greatest(0, extract(epoch from (now() - e.break_started_at))::int),
      break_started_at = null
    where id = _entry;
  else
    update time_entries set break_started_at = now() where id = _entry;
  end if;
end $$;

grant execute on function public.record_clock_in(uuid, uuid, numeric, numeric, numeric) to authenticated;
grant execute on function public.record_clock_out(uuid, uuid, numeric, numeric, boolean) to authenticated;
grant execute on function public.record_toggle_break(uuid, uuid) to authenticated;
