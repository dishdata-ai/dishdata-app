-- ============================================================================
-- 0068 · Kokoland menu text: casing, stray German in English names, and the
--        German names/headings that were never filled in
--
-- Three problems, all visible to a customer reading the catering page or the
-- QR menu:
--
--   1. Casing drifted as dishes were added by hand — "Kerala Beef biriyani",
--      "Kadala curry", four "Rice bowl" where their siblings say "Rice Bowl".
--   2. Four English names carry German ("Kokoland Pork Reis Bowl", and a
--      Gemüse-Frikadellen gloss welded onto the cutlet with no space).
--   3. 27 dishes had no German name at all and 29 more repeated the English
--      one, so the German menu quietly served English. Worse, rows inside one
--      category disagreed about that category's German heading — Starters
--      carried both "STARTERS" and "Vorspeisen", Rice Bowls both "Rice Bowls"
--      and "Reisschalen" — and the page takes whichever it meets first.
--
-- Renaming a recipe is not free: sales imported from SumUp are matched back to
-- a recipe BY NAME (case-insensitively, either string containing the other —
-- see matchRecipeId in src/lib/channels/sumup.ts), and that match is what
-- depletes stock. Every rename below was checked against the 61 distinct item
-- names the till has actually rung up: each one is either case-only or leaves
-- the till's string still containing the recipe's, so every existing line goes
-- on matching.
--
-- Deliberately NOT renamed here, because they would break that match:
--   'Idiyappam with Chicken Curry (mit Knochen)'
--   'Pathiri with Chicken Curry (mit Knochen)'
-- Their siblings all say "(with Bone)", but SumUp sells them under the German
-- string. Rename the two items on the till first, then fix these to match.
--
-- The English `category` values are left alone too — one holds German
-- ("Idiyappam Combos (Südindische Reisnudel)") — because the category order
-- saved in org settings keys off that exact text.
--
-- Data only, for one org, so this is not mirrored into setup.sql.
-- ============================================================================

do $$
declare _org uuid;
begin
  select id into _org from public.orgs where slug = 'kokoland-berlin';
  if _org is null then
    raise notice 'kokoland-berlin not found — nothing to do';
    return;
  end if;

  -- 1 ·  English names: casing, and the German that crept in ----------------
  update public.recipes set name = v.fixed
    from (values
      ('Kerala Beef biriyani',                                      'Kerala Beef Biriyani'),
      ('Kadala curry',                                              'Kadala Curry'),
      ('Coconut pudding',                                           'Coconut Pudding'),
      ('Porotta with Kerala Beef fry',                              'Porotta with Kerala Beef Fry'),
      ('Rice with Kerala Beef fry',                                 'Rice with Kerala Beef Fry'),
      ('Porotta with Veg kuruma',                                   'Porotta with Veg Kuruma'),
      ('Kokoland Beef Rice bowl',                                   'Kokoland Beef Rice Bowl'),
      ('Kokoland Chicken Rice bowl',                                'Kokoland Chicken Rice Bowl'),
      ('Kokoland Veg Kurma Rice bowl',                              'Kokoland Veg Kurma Rice Bowl'),
      ('Kokoland paneer Rice bowl',                                 'Kokoland Paneer Rice Bowl'),
      ('Kokoland Pork Reis Bowl',                                   'Kokoland Pork Rice Bowl'),
      ('Kerala Vegetable Cutlet(Südindische Gemüse-Frikadellen)',   'Kerala Vegetable Cutlet'),
      ('Kokoland pazham pori (2 Nos)',                              'Kokoland Pazham Pori (2 nos)'),
      ('Kerala non veg mini meals (beef)',                          'Kerala Non Veg Mini Meals (Beef)'),
      ('Kerala non veg mini meals (chicken)',                       'Kerala Non Veg Mini Meals (Chicken)'),
      ('Kerala veg mini meals',                                     'Kerala Veg Mini Meals')
    ) as v(old, fixed)
   where recipes.org_id = _org and recipes.name = v.old;

  -- 2 ·  German names — filled in where missing, corrected where they were
  --      still English. Matched to the house pattern already in the data:
  --      "<Beilage> mit <Gericht>", and "Kokoland <Zutat>-Reisschale".
  --      Dishes whose German is genuinely the same word (Porotta, Puttu,
  --      Paneer Biriyani, the Fritz-Kola line, the Rolls) keep falling back
  --      to the English name rather than storing a duplicate.
  --
  --      These match on the names as section 1 above leaves them, not the
  --      ones it started from.
  update public.recipes set name_de = v.de
    from (values
      ('Water Bottle Small',                          'Wasser klein'),
      ('Kerala Chicken Biriyani (with Bone)',         'Kerala Chicken Biriyani (mit Knochen)'),
      ('Kokoland Chicken 65 Biriyani (with Bone)',    'Kokoland Chicken 65 Biriyani (mit Knochen)'),
      ('Coconut Pudding',                             'Kokospudding'),
      ('Idiyappam with Beef Curry',                   'Idiyappam mit Beef Curry'),
      ('Idiyappam with Chicken Curry (mit Knochen)',  'Idiyappam mit Chicken Curry (mit Knochen)'),
      ('Idiyappam with Chickpeas (Kadala) Curry',     'Idiyappam mit Kadala Curry'),
      ('Idiyappam with Veg Kurma',                    'Idiyappam mit Veg Kuruma'),
      ('Kappa with Kottayam Fish Curry',              'Kappa mit Kottayam Fish Curry'),
      ('Chicken Loaded Fries',                        'Loaded Fries mit Hähnchen'),
      ('Kidney Beans Loaded Fries',                   'Loaded Fries mit Kidneybohnen'),
      ('Pathiri with Beef Curry',                     'Pathiri mit Beef Curry'),
      ('Pathiri with Chicken Curry (mit Knochen)',    'Pathiri mit Chicken Curry (mit Knochen)'),
      ('Pathiri with Chickpeas (Kadala) Curry',       'Pathiri mit Kadala Curry'),
      ('Pathiri with Veg Kuruma',                     'Pathiri mit Veg Kuruma'),
      ('Porotta with Pepper Chicken',                 'Porotta mit Pepper Chicken'),
      ('Porotta with Pork Roast',                     'Porotta mit Pork Roast'),
      ('Porotta with Veg Kuruma',                     'Porotta mit Veg Kuruma'),
      ('Puttu with Beef Curry',                       'Puttu mit Beef Curry'),
      ('Puttu with Veg Kurma',                        'Puttu mit Veg Kuruma'),
      ('Rice with Paneer Butter Masala',              'Reis mit Paneer Butter Masala'),
      ('Kokoland Beef Rice Bowl',                     'Kokoland Beef-Reisschale'),
      ('Kokoland Chicken Rice Bowl',                  'Kokoland Chicken-Reisschale'),
      ('Kokoland Pork Rice Bowl',                     'Kokoland Pork-Reisschale'),
      ('Kerala Vegetable Cutlet',                     'Südindische Gemüse-Frikadellen'),
      ('Kerala Chicken Cutlet',                       'Kerala Chicken-Frikadellen'),
      ('Chicken Roll (2 nos)',                        'Chicken Roll (2 Stk.)'),
      ('Kokoland Pazham Pori (2 nos)',                'Kokoland Pazham Pori (2 Stk.)'),
      ('Kokoland Onion Pakoda',                       'Kokoland Zwiebel-Pakoda'),
      ('Kokoland Chicken 65 (with Bone)',             'Kokoland Chicken 65 (mit Knochen)')
    ) as v(en, de)
   where recipes.org_id = _org and recipes.name = v.en;

  -- 3 ·  One agreed German heading per category, on every row in it, so the
  --      German page stops picking whichever row it happens to read first.
  update public.recipes set category_de = v.de
    from (values
      ('Beverages',                                       'Getränke'),
      ('Biriyanis',                                       'Biriyani'),
      ('Desserts',                                        'Desserts'),
      ('Extras',                                          'Extras'),
      ('Idiyappam Combos (Südindische Reisnudel)',        'Idiyappam-Combos (Südindische Reisnudeln)'),
      ('Idli Combos',                                     'Idli Combos'),
      ('KERALA SADHYA AND MINI MEALS | Vegetarian Feast', 'Kerala Sadhya & Mini-Menüs | Vegetarisches Festmahl'),
      ('Kappa Dishes',                                    'Kappa-Gerichte'),
      ('Koko Specials',                                   'Koko Spezialitäten'),
      ('Koko Sweet Specialties',                          'Koko Süßspeisen'),
      ('Loaded Fries',                                    'Loaded Fries'),
      ('Pathiri Combos (Hauchfeine Reis-Crêpe)',          'Pathiri-Combos (Hauchfeine Reis-Crêpes)'),
      ('Porotta Combos',                                  'Porotta-Combos'),
      ('Puttu Dishes',                                    'Puttu-Gerichte'),
      ('Rice & Curry Combo',                              'Reis & Curry Combo'),
      ('Rice Bowls',                                      'Reisschalen'),
      ('Rolls',                                           'Rolls'),
      ('Salads',                                          'Salate'),
      ('Snacks',                                          'Snacks'),
      ('Starters',                                        'Vorspeisen'),
      ('Wraps & Sandwiches',                              'Wraps & Sandwiches')
    ) as v(en, de)
   where recipes.org_id = _org and recipes.category = v.en;
end $$;
