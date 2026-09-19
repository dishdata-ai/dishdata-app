-- ============================================================================
-- 0053 · Vegetarian/vegan tag on recipes
--
-- Single nullable tag rather than two booleans — a dish is regular, veg, or
-- vegan, never veg-and-vegan-both, so one column with a check constraint
-- says that directly instead of leaving "is_veg=false, is_vegan=true" as a
-- state the schema allows but the app would have to guard against everywhere
-- it reads these two fields together. Shown as a small symbol next to the
-- name on the printed menu and the public storefront; null (the default for
-- every existing recipe) shows nothing, so this is a pure opt-in addition —
-- no dish is retroactively mislabeled.
-- ============================================================================

alter table public.recipes
  add column if not exists diet text check (diet in ('veg', 'vegan'));
