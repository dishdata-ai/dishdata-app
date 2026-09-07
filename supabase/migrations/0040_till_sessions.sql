-- ============================================================================
-- 0040 · Till sessions and cash movements
--
-- Until now "expected cash in drawer" was just the sum of that day's cash
-- payments — no opening float, no petty-cash withdrawals, no record of what
-- was actually counted, and nothing persisted. That answers "what did we
-- take?" but not "does the drawer balance?", which is the question that
-- matters at close and the one German law actually asks.
--
-- §146 AO / GoBD require a cash book that is Kassensturz-fähig: at any moment
-- the recorded balance must be comparable against a physical count, with
-- every movement in and out individually recorded and given a reason. That
-- means the float, the counted amount, and the difference all have to be
-- stored as first-class facts — a difference is evidence, not an error to be
-- silently corrected away, so `close_till` records it rather than refusing to
-- close on a mismatch.
--
-- Cash sales attach to a session by TIME rather than by a foreign key on
-- payments: sessions are strictly sequential (one open per org, enforced by
-- a partial unique index), so the window is unambiguous and reconstructible,
-- and the hot checkout path stays untouched. The deliberate consequence is
-- that a cash sale rung up with no session open belongs to no session — that
-- is surfaced as a warning rather than hidden, because it's a real
-- bookkeeping gap the restaurant needs to see.
-- ============================================================================

do $$ begin
  create type till_status as enum ('open', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

create table if not exists public.till_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  status till_status not null default 'open',
  opening_float numeric not null default 0,
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  closed_by uuid,
  -- All three are snapshots taken at close: `expected` is what the books said,
  -- `counted` is what was physically in the drawer, `difference` is counted
  -- minus expected. Stored rather than recomputed so a later refund or a
  -- backdated correction can never quietly rewrite a closed day's cash book.
  expected_closing numeric,
  counted_closing numeric,
  difference numeric,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists till_sessions_org_opened_idx
  on public.till_sessions (org_id, opened_at desc);

-- At most one open till per restaurant — the whole time-window attribution
-- model depends on sessions never overlapping.
create unique index if not exists till_sessions_one_open_per_org
  on public.till_sessions (org_id) where status = 'open';

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  session_id uuid not null references public.till_sessions(id) on delete cascade,
  direction cash_direction not null,
  -- Always positive; `direction` carries the sign. Storing a signed amount
  -- invites a negative "cash in" that reads as a withdrawal in one report and
  -- a deposit in another.
  amount numeric not null check (amount > 0),
  reason text not null default '',
  comment text,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists cash_movements_session_idx
  on public.cash_movements (session_id, created_at);

alter table public.till_sessions enable row level security;
alter table public.cash_movements enable row level security;

drop policy if exists till_sessions_member_read on public.till_sessions;
create policy till_sessions_member_read on public.till_sessions
  for select using (is_org_member(org_id));

drop policy if exists cash_movements_member_read on public.cash_movements;
create policy cash_movements_member_read on public.cash_movements
  for select using (is_org_member(org_id));

-- Writes go exclusively through the definer functions below: opening,
-- closing and recording movements each carry invariants (one open session,
-- expected-balance maths, no reopening a closed session) that a bare INSERT
-- from the client would bypass.

-- ----------------------------------------------------------------------------
-- Cash counted as belonging to a session: the float, plus cash taken while it
-- was open, plus/minus manual movements. Shared by the live balance and by
-- close_till so the number staff watch during service and the number they are
-- reconciled against at close can never be computed two different ways.
-- ----------------------------------------------------------------------------
create or replace function public.till_expected_cash(_session uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  s public.till_sessions;
  _cash_sales numeric;
  _in numeric;
  _out numeric;
begin
  select * into s from till_sessions where id = _session;
  if s.id is null then raise exception 'till session not found'; end if;
  if not is_org_member(s.org_id) then raise exception 'not a member of this organization'; end if;

  -- Voided and refunded orders are excluded rather than subtracted: a refund
  -- is only a status change on the order (no negative payment row exists), so
  -- counting its original cash payment would report money as sitting in a
  -- drawer it has already been handed back out of.
  select coalesce(sum(p.amount + p.tip_amount), 0) into _cash_sales
  from payments p
  join orders o on o.id = p.order_id
  where p.org_id = s.org_id
    and p.method = 'cash'
    and o.status not in ('void', 'refunded')
    and p.created_at >= s.opened_at
    and (s.closed_at is null or p.created_at <= s.closed_at);

  select
    coalesce(sum(amount) filter (where direction = 'in'), 0),
    coalesce(sum(amount) filter (where direction = 'out'), 0)
  into _in, _out
  from cash_movements where session_id = _session;

  return s.opening_float + _cash_sales + _in - _out;
end $$;

create or replace function public.open_till(_org uuid, _opening_float numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _opening_float < 0 then raise exception 'opening float cannot be negative'; end if;
  if exists (select 1 from till_sessions where org_id = _org and status = 'open') then
    raise exception 'a till is already open for this organization';
  end if;

  insert into till_sessions (org_id, opening_float, opened_by)
  values (_org, _opening_float, auth.uid())
  returning id into _id;
  return _id;
end $$;

create or replace function public.record_cash_movement(
  _org uuid,
  _direction text,
  _amount numeric,
  _reason text default '',
  _comment text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _session uuid; _available numeric; _id uuid;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _amount is null or _amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if _direction not in ('in', 'out') then raise exception 'direction must be in or out'; end if;

  select id into _session from till_sessions where org_id = _org and status = 'open';
  if _session is null then raise exception 'no till is currently open'; end if;

  -- A drawer cannot hand out money it does not hold; letting it go negative
  -- produces a cash book that can never be reconciled against a real count.
  if _direction = 'out' then
    _available := till_expected_cash(_session);
    if _amount > _available then
      raise exception 'cannot take out more than the drawer holds (available %)', _available;
    end if;
  end if;

  insert into cash_movements (org_id, session_id, direction, amount, reason, comment, created_by)
  values (_org, _session, _direction::cash_direction, _amount, coalesce(_reason, ''), _comment, auth.uid())
  returning id into _id;
  return _id;
end $$;

create or replace function public.close_till(
  _org uuid,
  _counted numeric,
  _note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare _session uuid; _expected numeric;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _counted is null or _counted < 0 then raise exception 'counted amount cannot be negative'; end if;

  select id into _session from till_sessions where org_id = _org and status = 'open';
  if _session is null then raise exception 'no till is currently open'; end if;

  _expected := till_expected_cash(_session);

  -- A mismatch closes the till and is recorded as the difference. Refusing to
  -- close on a discrepancy would only teach staff to enter the expected
  -- number, which destroys exactly the evidence the cash book exists to keep.
  update till_sessions set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    expected_closing = _expected,
    counted_closing = _counted,
    difference = _counted - _expected,
    note = _note
  where id = _session;

  return _session;
end $$;

grant execute on function public.till_expected_cash(uuid) to authenticated;
grant execute on function public.open_till(uuid, numeric) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.close_till(uuid, numeric, text) to authenticated;

insert into public.modules (id, name, grouping, sort) values
  ('till', 'Till & Cash', 'Money', 15)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;
