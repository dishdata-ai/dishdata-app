-- ============================================================================
-- Seed: KOMBANS FOOTBALL TOURNAMENT 2026 — Kokoland's event menu
--
-- Creates the 13 tournament dishes as recipes, creates the event menu, and
-- links them so staff can pick "Kombans Football Tournament 2026" in the POS
-- and see only these items (grouped by Breakfast / Lunch / Snacks / Dinner /
-- Uppilittathu / Drinks).
--
-- Prices are GROSS (VAT-included), per the VAT-included model in 0017 — ringing
-- up "Porotta + Beef Curry" charges exactly €14.00, with 7% VAT contained.
--
-- IDEMPOTENT: re-running never duplicates recipes, the menu, or its links.
-- Requires migration 0016 (event_menus) to be applied.
--
-- "Chicken Biriyani", "Paneer Biriyani" and "Chicken Roll" are named
-- "... (Tournament)" below — the real takeaway menu (seed_kokoland_menu.sql)
-- has full-portion dishes with the same plain names, and since event-menu
-- dishes stay visible in the POS "full menu" too, the identical labels at
-- different prices were a till mix-up risk. Renamed here instead of there
-- since these are the smaller, event-only portions.
-- ============================================================================

-- 0. Rename any already-seeded rows from a prior run under the old plain
--    names, so this stays idempotent whether or not it ran before.
update public.recipes r
set name = v.new_name
from public.orgs o,
     (values
       ('Chicken Biriyani', 13.00, 'Chicken Biriyani (Tournament)'),
       ('Paneer Biriyani',  13.00, 'Paneer Biriyani (Tournament)'),
       ('Chicken Roll',      2.00, 'Chicken Roll (Tournament)')
     ) as v(old_name, old_price, new_name)
where r.org_id = o.id
  and o.slug = 'kokoland-berlin'
  and r.name = v.old_name
  and r.price = v.old_price;

-- 1. The dishes -------------------------------------------------------------
insert into public.recipes (org_id, name, category, price, prep_minutes, emoji, is_active)
select o.id, v.name, v.category, v.price, v.prep_minutes, v.emoji, true
from public.orgs o
cross join (values
  ('Chicken Wrap',                  'Breakfast',    5.00,  8, '🌯'),
  ('Chicken Biriyani (Tournament)', 'Lunch',       13.00, 20, '🍛'),
  ('Paneer Biriyani (Tournament)',  'Lunch',       13.00, 20, '🧀'),
  ('Pazhampori',                    'Snacks',       1.50,  6, '🍌'),
  ('Chicken Roll (Tournament)',     'Snacks',       2.00,  8, '🌯'),
  ('Onion Pakoda',                  'Snacks',       2.00,  6, '🧅'),
  ('Porotta + Beef Curry',    'Dinner',      14.00, 15, '🥩'),
  ('Porotta + Chicken Curry', 'Dinner',      12.00, 15, '🍗'),
  ('Porotta + Veg Curry',     'Dinner',      10.00, 15, '🥔'),
  ('Pineapple Uppilittathu',  'Uppilittathu', 1.00,  2, '🍍'),
  ('Mango Uppilittathu',      'Uppilittathu', 1.00,  2, '🥭'),
  ('Mango Lassi',             'Drinks',       2.00,  4, '🥤'),
  ('Indian Masala Chai',      'Drinks',       2.00,  4, '🍵')
) as v(name, category, price, prep_minutes, emoji)
where o.slug = 'kokoland-berlin'
  and not exists (
    select 1 from public.recipes r where r.org_id = o.id and r.name = v.name
  );

-- 2. The event menu ---------------------------------------------------------
insert into public.event_menus (org_id, name, is_active)
select o.id, 'Kombans Football Tournament 2026', true
from public.orgs o
where o.slug = 'kokoland-berlin'
  and not exists (
    select 1 from public.event_menus em
    where em.org_id = o.id and em.name = 'Kombans Football Tournament 2026'
  );

-- 3. Link every tournament dish to the event menu ---------------------------
insert into public.event_menu_items (org_id, event_menu_id, recipe_id)
select o.id, em.id, r.id
from public.orgs o
join public.event_menus em
  on em.org_id = o.id and em.name = 'Kombans Football Tournament 2026'
join public.recipes r
  on r.org_id = o.id
 and r.name in (
   'Chicken Wrap','Chicken Biriyani (Tournament)','Paneer Biriyani (Tournament)',
   'Pazhampori','Chicken Roll (Tournament)','Onion Pakoda',
   'Porotta + Beef Curry','Porotta + Chicken Curry','Porotta + Veg Curry',
   'Pineapple Uppilittathu','Mango Uppilittathu',
   'Mango Lassi','Indian Masala Chai'
 )
where o.slug = 'kokoland-berlin'
on conflict (event_menu_id, recipe_id) do nothing;

-- Verify: should return 13 rows, grouped by category.
select r.category, r.name, r.price
from public.event_menu_items emi
join public.event_menus em on em.id = emi.event_menu_id
join public.recipes r on r.id = emi.recipe_id
join public.orgs o on o.id = em.org_id
where o.slug = 'kokoland-berlin'
  and em.name = 'Kombans Football Tournament 2026'
order by
  case r.category
    when 'Breakfast' then 1 when 'Lunch' then 2 when 'Snacks' then 3
    when 'Dinner' then 4 when 'Uppilittathu' then 5 when 'Drinks' then 6 else 7
  end,
  r.name;
