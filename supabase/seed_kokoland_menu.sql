-- ============================================================================
-- Seed Kokoland Berlin's menu into DishData `recipes`
--
-- Replaces the earlier placeholder dish list with the real menu, taken
-- verbatim (names + prices) from the live Wolt listing as of 2026-07-31.
-- Kokoland has started taking takeaway orders directly, so this is now the
-- normal walk-in / takeaway / dine-in menu shown in the POS "full menu" view.
--
-- Prices match what's currently listed on Wolt — no delivery markup has been
-- applied yet, so these double as the normal (non-delivery) price for now.
-- Re-price here later if a separate delivery price sheet is introduced.
--
-- This is INTENTIONALLY separate from supabase/seed_kombans_event_menu.sql
-- (the "Kombans Football Tournament 2026" event menu). Do not merge them:
-- the event menu is a smaller, specially-priced tournament menu, selected
-- on its own tab in POS, and must stay out of this file.
--
-- NOTE — "Chicken Biriyani", "Paneer Biriyani" and "Chicken Roll" also exist
-- as smaller, differently-priced dishes on the Kombans Football Tournament
-- event menu. Those were renamed to "... (Tournament)" in
-- seed_kombans_event_menu.sql to avoid a same-name-different-price mix-up at
-- the till, since event dishes stay visible in the POS "full menu" too. This
-- file's rows (matched below on name AND price) are the real, full-portion
-- dishes and keep their plain names.
--
-- IDEMPOTENT: re-running skips any dish already present at the same name
-- and price for the org, so it will never create duplicates.
-- ============================================================================

insert into public.recipes (org_id, name, category, price, prep_minutes, emoji, is_active)
select o.id, v.name, v.category, v.price, v.prep_minutes, v.emoji, true
from public.orgs o
cross join (values
  -- Starters
  ('Kokoland Chicken 65',              'Starters',            6.90, 12, '🍗'),
  ('Kokoland Beef Dry Fry',            'Starters',            9.50, 15, '🥩'),
  ('Kokoland Paneer Chilli',           'Starters',            7.50, 12, '🧀'),
  ('Kokoland Chilli Pork',             'Starters',            8.90, 14, '🌶️'),
  ('Kokoland Pork Roast',              'Starters',            9.90, 18, '🍖'),
  -- Porotta Combos
  ('Porotta mit Chicken Curry',        'Porotta Combos',     14.99, 18, '🥘'),
  ('Porotta Veg Kuruma',               'Porotta Combos',     12.99, 15, '🥕'),
  ('Porotta mit Pork Roast',           'Porotta Combos',     14.99, 18, '🍖'),
  ('Porotta mit Pepper Chicken',       'Porotta Combos',     16.50, 18, '🌶️'),
  ('Porotta mit Beef Roast',           'Porotta Combos',     17.90, 20, '🥩'),
  ('Porotta mit Kerala Beef Fry',      'Porotta Combos',     19.90, 20, '🥥'),
  ('Porotta mit Paneer Butter Masala', 'Porotta Combos',     13.90, 15, '🧈'),
  -- Biriyanis
  ('Chicken Biriyani',                 'Biriyanis',          15.99, 25, '🍛'),
  ('Beef Biriyani',                    'Biriyanis',          17.99, 28, '🍛'),
  ('Pork Biriyani',                    'Biriyanis',          16.99, 28, '🍛'),
  ('Paneer Biriyani',                  'Biriyanis',          14.99, 22, '🍛'),
  -- Wraps und Sandwiches
  ('Koko Special Chicken Wrap',        'Wraps & Sandwiches',  6.50,  8, '🌯'),
  ('Koko Special Tofu Vegan Wrap',     'Wraps & Sandwiches',  5.50,  8, '🌯'),
  ('Koko Chicken Sandwich',            'Wraps & Sandwiches',  5.50,  8, '🥪'),
  ('Koko Tofu Vegan Sandwich',         'Wraps & Sandwiches',  4.99,  8, '🥪'),
  -- Rolls
  ('Porotta Chicken Tikka Roll',       'Rolls',               6.99, 10, '🌯'),
  ('Porotta Beef Roll',                'Rolls',               8.50, 10, '🌯'),
  ('Porotta Paneer Tikka Roll',        'Rolls',               5.99, 10, '🌯'),
  -- Rice Bowls
  ('Kokoland Chicken Reis Bowl',       'Rice Bowls',         13.90, 15, '🍚'),
  ('Kokoland Beef Reis Bowl',          'Rice Bowls',         15.99, 18, '🍚'),
  ('Kokoland Pork Reis Bowl',          'Rice Bowls',         14.99, 18, '🍚'),
  ('Kokoland Paneer Reis Bowl',        'Rice Bowls',         12.50, 14, '🍚'),
  ('Kokoland Kidney Beans Reis Bowl',  'Rice Bowls',         11.99, 14, '🍚'),
  -- Kappa Dishes
  ('Kerala Kappa Biriyani',            'Kappa Dishes',       16.50, 25, '🍲'),
  ('Kappa mit Kottayam Fish Curry',    'Kappa Dishes',       17.50, 22, '🐟'),
  -- Puttu Dishes
  ('Puttu mit Kadala Curry',           'Puttu Dishes',        9.90, 15, '🥥'),
  -- Snacks
  ('Chicken Roll',                     'Snacks',              7.00, 10, '🥟'),
  ('Samosa',                           'Snacks',              7.00, 10, '🥟'),
  ('Beef Cutlet',                      'Snacks',              8.00, 12, '🥩'),
  ('Kokoland Banana Fritters',         'Snacks',              7.00,  8, '🍌'),
  ('Kokoland Onion Pakoda',            'Snacks',              5.50,  8, '🧅'),
  -- Loaded Fries
  ('Chicken Loaded Fries',             'Loaded Fries',        6.99, 10, '🍟'),
  ('Beef Loaded Fries',                'Loaded Fries',        8.99, 12, '🍟'),
  ('Kidney Beans Loaded Fries',        'Loaded Fries',        5.99, 10, '🍟'),
  -- Extras
  ('Reis',                             'Extras',              2.00,  5, '🍚'),
  ('Porotta',                          'Extras',              3.00,  5, '🫓'),
  ('Puttu',                            'Extras',              4.00,  8, '🥥'),
  ('Kadala Curry',                     'Extras',              8.00, 10, '🫘'),
  -- Desserts
  ('Coconut Pudding',                  'Desserts',            4.50,  5, '🍮'),
  ('Semiya Kesari',                    'Desserts',            3.50,  8, '🍮')
) as v(name, category, price, prep_minutes, emoji)
where o.slug = 'kokoland-berlin'
  and not exists (
    select 1 from public.recipes r
    where r.org_id = o.id and r.name = v.name and r.price = v.price
  );

-- The old placeholder dishes (dev/demo data, never the real menu) — take
-- them off the live POS menu now that the real one is seeded above. They are
-- deactivated, not deleted, so any historical orders referencing them are
-- untouched and they can be reactivated if that's wrong.
update public.recipes r
set is_active = false
from public.orgs o
where r.org_id = o.id
  and o.slug = 'kokoland-berlin'
  and r.name in (
    'Kerala Chicken 65', 'Banana Chips', 'Parippu Vada',
    'Fish Moilee', 'Chicken Mappas', 'Malabar Biryani', 'Puttu & Kadala',
    'Appam with Stew', 'Beef Fry', 'Avial', 'Payasam', 'Unniyappam',
    'Masala Chai', 'Kerala Lemonade', 'Kerala Filter Coffee'
  );

-- Verify: should return the ~45 real items above, none of the placeholder names.
select r.category, r.name, r.price
from public.recipes r
join public.orgs o on o.id = r.org_id
where o.slug = 'kokoland-berlin' and r.is_active
order by r.category, r.name;
