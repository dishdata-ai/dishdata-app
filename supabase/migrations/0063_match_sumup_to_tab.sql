-- ============================================================================
-- 0063 · Reconcile QR tabs against the SumUp sale that paid for them
--
-- A guest orders on the QR menu, then pays at the counter on SumUp. That
-- produced two rows for one meal: an open 'storefront' order that nobody ever
-- closed, and a paid 'sumup' order. Revenue counts everything that is not void
-- or refunded, so every QR order was being counted twice — 73 orders and
-- €1,589 of a €10,150 total at the time this was written, about 16%.
--
-- Matching is exact rather than fuzzy, because SumUp's sync already separates
-- the tip into its own column: the food total is (total - tip), and that equals
-- the tab total to the cent. Item names only confirm, and only matter when two
-- tabs happen to share a total.
--
-- The tab is linked, not voided. Void means cancelled, and this food was very
-- much cooked and sold; the SumUp sale is the fiscal record and the tab is the
-- ordering record, so the tab keeps its items and points at the sale that
-- settled it. Anything carrying merged_into is excluded from revenue in the app
-- (see calc.ts / Reports.tsx), and the link can simply be cleared to undo.
-- ============================================================================

alter table public.orders
  add column if not exists merged_into uuid references public.orders(id) on delete set null;

comment on column public.orders.merged_into is
  'Set when this order was settled by another order (a QR tab paid on SumUp). Excluded from revenue; the target order is the financial record.';

create index if not exists orders_merged_into_idx
  on public.orders (merged_into) where merged_into is not null;

-- How much two orders' item lists agree, 0..1, comparing lower-cased names.
-- SumUp's names differ from the menu's only in casing ("Paneer biriyani"),
-- which is exactly what this is meant to see through.
create or replace function public.order_items_overlap(_a jsonb, _b jsonb)
returns numeric language sql immutable set search_path = public as $$
  with a as (select distinct lower(trim(value->>'name')) as n from jsonb_array_elements(coalesce(_a, '[]'::jsonb))),
       b as (select distinct lower(trim(value->>'name')) as n from jsonb_array_elements(coalesce(_b, '[]'::jsonb))),
       hits as (select count(*)::numeric c from a join b using (n)),
       sizes as (select greatest((select count(*) from a), (select count(*) from b), 1)::numeric c)
  select (select c from hits) / (select c from sizes);
$$;

/**
 * Link one SumUp sale to the QR tab it paid for, if exactly one fits.
 *
 * Conservative on purpose: a wrong link silently moves money between days, so
 * anything ambiguous is left alone for a human rather than guessed at.
 */
create or replace function public.match_sumup_order(_sale_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _sale record; _food numeric; _n int; _tab uuid; _best numeric; _ties int;
begin
  select * into _sale from orders where id = _sale_id;
  if not found or _sale.source <> 'sumup' or _sale.status in ('void', 'refunded') then return null; end if;

  _food := round(_sale.total - coalesce(_sale.tip, 0), 2);
  if _food <= 0 then return null; end if;

  -- Candidates: unsettled QR tabs for the same money, from around this sale.
  -- One statement rather than a temp table: this runs inside a trigger on
  -- every SumUp insert, and a temp table there is both slower and fussier
  -- (it outlives the call within a transaction, so the backfill loop below
  -- would have to keep clearing it).
  with cand as (
    select o.id, order_items_overlap(o.items, _sale.items) as score
      from orders o
     where o.org_id = _sale.org_id
       and o.source = 'storefront'
       and o.status = 'open'
       and o.merged_into is null
       and o.id <> _sale.id
       and round(o.total, 2) = _food
       and o.created_at between _sale.created_at - interval '8 hours'
                            and _sale.created_at + interval '30 minutes'
  ), agg as (select count(*) as n, coalesce(max(score), 0) as best from cand)
  select c.id, a.n, a.best, (select count(*) from cand where score >= a.best - 0.01)
    into _tab, _n, _best, _ties
    from cand c cross join agg a
   order by c.score desc, c.id
   limit 1;

  if coalesce(_n, 0) = 0 then return null; end if;

  -- Same total on two tabs: let the item names break the tie, and only when
  -- one is clearly better. Otherwise leave both for someone to look at.
  if _n > 1 and (_ties > 1 or _best < 0.5) then return null; end if;

  update orders
     set merged_into = _sale.id,
         status = 'paid',
         kitchen_status = case when kitchen_status = 'served' then kitchen_status else 'served'::kitchen_status end
   where id = _tab;

  return _tab;
end $$;

-- Match on the way in, so a sale synced by cron or accepted by hand both land
-- here without the sync code having to remember to call it.
create or replace function public.trg_match_sumup_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'sumup' and new.status not in ('void', 'refunded') then
    perform match_sumup_order(new.id);
  end if;
  return new;
end $$;

drop trigger if exists orders_match_sumup on public.orders;
create trigger orders_match_sumup
  after insert on public.orders
  for each row execute function public.trg_match_sumup_order();

-- ---------------------------------------------------------------------------
-- Backfill: settle the tabs already sitting open against sales already synced.
-- Same conservative rule, so ambiguous pairs stay untouched and visible.
-- ---------------------------------------------------------------------------
do $$
declare s record;
begin
  for s in
    select id from orders
     where source = 'sumup' and status not in ('void', 'refunded')
     order by created_at
  loop
    perform match_sumup_order(s.id);
  end loop;
end $$;
