-- ============================================================================
-- 0064 · Make SumUp↔tab matching reliable for new orders
--
-- 0063's backfill linked 16 of 73 historical tabs. Reviewing the misses showed
-- the rule was right to refuse most of them (21 had a same-total sale a median
-- of 48 hours away — coincidence, not the same meal), but it also refused at
-- least one obvious pair: a tab at 17:21 and a sale at 17:20, same total, same
-- "Paneer Biriyani" on both sides, rejected only because a sibling tab shared
-- the total and the tie-break gave up.
--
-- Two changes, both aimed at orders placed from here on:
--
-- 1. Anchor on the tab's LAST ACTIVITY, not when it was opened. Now that a
--    table builds one running tab (0062), a party may open at 18:00, add a
--    round at 19:30 and pay at 19:40 — ten minutes after the last thing they
--    ordered, but nearly two hours after the tab began. updated_at is
--    maintained by the set_updated_at trigger, so it tracks the last round.
--
-- 2. Break ties on time proximity before giving up. Two tabs with the same
--    total is common (€13.50 is a popular bill); two tabs with the same total
--    *within a couple of minutes of the same payment* is not. Only genuinely
--    indistinguishable pairs — alike on both name overlap and timing — are
--    still left for a human.
--
-- The window also tightens from -8h/+30m to -30m/+4h around last activity,
-- because payment follows the last round rather than preceding the first. That
-- alone removes most of the coincidental candidates that caused the ties.
-- ============================================================================

create or replace function public.match_sumup_order(_sale_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  _sale record; _food numeric;
  _n int; _tab uuid; _best numeric; _best_gap numeric; _ties int;
begin
  select * into _sale from orders where id = _sale_id;
  if not found or _sale.source <> 'sumup' or _sale.status in ('void', 'refunded') then return null; end if;

  _food := round(_sale.total - coalesce(_sale.tip, 0), 2);
  if _food <= 0 then return null; end if;

  with cand as (
    select o.id,
           order_items_overlap(o.items, _sale.items) as score,
           -- Minutes between the sale and the last time anything was added to
           -- the tab; the real pair is normally single digits.
           abs(extract(epoch from (_sale.created_at - greatest(o.created_at, o.updated_at))) / 60) as gap
      from orders o
     where o.org_id = _sale.org_id
       and o.source = 'storefront'
       and o.status = 'open'
       and o.merged_into is null
       and o.id <> _sale.id
       and round(o.total, 2) = _food
       and greatest(o.created_at, o.updated_at)
             between _sale.created_at - interval '4 hours'
                 and _sale.created_at + interval '30 minutes'
  ), ranked as (
    select c.*, row_number() over (order by c.score desc, c.gap asc) as rn from cand c
  )
  select r.id, (select count(*) from cand), r.score, r.gap,
         -- Rivals that are just as good on BOTH signals: same name overlap and
         -- within two minutes of the same distance from the payment.
         (select count(*) from ranked x
           where x.score >= r.score - 0.01 and abs(x.gap - r.gap) <= 2)
    into _tab, _n, _best, _best_gap, _ties
    from ranked r
   where r.rn = 1;

  if coalesce(_n, 0) = 0 then return null; end if;

  -- Evidence, not coincidence. Being the only candidate is NOT enough on its
  -- own: tested against real history, that alone would have linked a tab to a
  -- sale 71 minutes away with no item name in common. So the names have to
  -- agree — unless payment landed within five minutes of the last round and at
  -- least one item still matches, which is compelling even when SumUp spells
  -- things differently ("Water 0,5lr" against "Water Bottle Small").
  if not (_best >= 0.34 or (_best_gap <= 5 and _best > 0)) then return null; end if;

  -- Rivals alike on both signals stay for a human.
  if _n > 1 and _ties > 1 then return null; end if;

  update orders
     set merged_into = _sale.id,
         status = 'paid',
         kitchen_status = 'served'::kitchen_status
   where id = _tab;

  return _tab;
end $$;
