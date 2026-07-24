-- ============================================================================
-- Seed Kokoland Berlin's menu into DishData `recipes`
--
-- The kokoland-berlin org had ZERO recipes, which means the POS menu is empty
-- and staff cannot ring anything up. This loads the real menu (names + prices
-- taken verbatim from the live site's src/data/menu.ts).
--
-- Prices are GROSS (VAT-included), matching what guests see on the menu and
-- the VAT-included pricing model from migration 0017 — ringing up "Fish Moilee"
-- charges exactly €16.50, with the 7% VAT contained within.
--
-- IDEMPOTENT: re-running skips any dish already present for the org, so it
-- will never create duplicates.
--
-- The site's dish `type` maps to DishData's free-text `category`:
--   starter → Starters | main → Mains | side → Sides
--   dessert → Desserts | drink → Drinks
-- ============================================================================

insert into public.recipes (org_id, name, category, price, prep_minutes, emoji, is_active)
select o.id, v.name, v.category, v.price, v.prep_minutes, v.emoji, true
from public.orgs o
cross join (values
  -- Starters
  ('Kerala Chicken 65',     'Starters',  9.00, 12, '🍗'),
  ('Banana Chips',          'Starters',  4.50,  5, '🍌'),
  ('Parippu Vada',          'Starters',  5.50, 10, '🧆'),
  -- Mains
  ('Fish Moilee',           'Mains',    16.50, 20, '🐟'),
  ('Chicken Mappas',        'Mains',    15.00, 20, '🍛'),
  ('Malabar Biryani',       'Mains',    14.50, 25, '🍚'),
  ('Puttu & Kadala',        'Mains',    11.00, 18, '🥥'),
  ('Appam with Stew',       'Mains',    11.50, 18, '🥞'),
  ('Beef Fry',              'Mains',    17.00, 22, '🥩'),
  -- Sides
  ('Avial',                 'Sides',     8.50, 12, '🥗'),
  -- Desserts
  ('Payasam',               'Desserts',  6.00,  5, '🍮'),
  ('Unniyappam',            'Desserts',  6.50,  8, '🍩'),
  -- Drinks
  ('Masala Chai',           'Drinks',    3.50,  5, '🍵'),
  ('Kerala Lemonade',       'Drinks',    4.00,  3, '🍋'),
  ('Kerala Filter Coffee',  'Drinks',    3.50,  5, '☕')
) as v(name, category, price, prep_minutes, emoji)
where o.slug = 'kokoland-berlin'
  and not exists (
    select 1 from public.recipes r
    where r.org_id = o.id and r.name = v.name
  );

-- Verify: should return 15 rows.
select category, name, price
from public.recipes r
join public.orgs o on o.id = r.org_id
where o.slug = 'kokoland-berlin' and r.is_active
order by category, name;
