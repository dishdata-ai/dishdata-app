-- ============================================================================
-- 0051 · Derived recipe costing — units, yield, and a real cost formula
--
-- Inventory rebuild Phase 1. Today recipe_ingredients.cost is a number
-- someone typed by hand — it never moves when a supplier bill changes
-- inventory_items.unit_cost, so plate cost, food cost % and Menu
-- Engineering all silently drift from the real numbers. This migration adds
-- what's needed to compute cost instead of storing it as a guess:
--
--   recipe_ingredients.unit           the unit qty_numeric is expressed in.
--                                     NULL means "same as the stock item's
--                                     own unit" — the safety valve that keeps
--                                     every existing ingredient line
--                                     depleting stock exactly as it does
--                                     today (checkout_order is untouched by
--                                     this migration; qty_numeric still goes
--                                     straight into the stock delta with no
--                                     conversion — see 0051's own header
--                                     note in the app code, src/lib/units.ts).
--   recipe_ingredients.yield_pct      usable share after trimming/peeling —
--                                     a 40g ginger line at 85% yield costs
--                                     as if 40/0.85 g were bought.
--   recipe_ingredients.cost_override  the old typed number, kept ONLY for
--                                     lines with no stock link ("cost only"
--                                     ingredients) — a linked line's cost is
--                                     always computed, never overridden.
--   inventory_items.grams_per_unit    bridges a recipe line in grams against
--                                     stock counted in pieces, e.g. "1 lemon
--                                     ≈ 90 g" — null for items where a
--                                     piece-count/mass conversion makes no
--                                     sense (drinks, dry goods sold by pack).
--
-- unit_factor() mirrors src/lib/units.ts::unitFactor() exactly — keep both
-- in sync. It returns null when the two units can't be reconciled (crossing
-- mass and volume, or a piece conversion missing grams_per_unit); callers
-- fall back to the ingredient's own cost/cost_override rather than compute
-- a wrong number.
--
-- Idempotent — safe to re-run.
-- ============================================================================

alter table public.recipe_ingredients
  add column if not exists unit text,
  add column if not exists yield_pct numeric not null default 100,
  add column if not exists cost_override numeric;

do $$ begin
  alter table public.recipe_ingredients
    add constraint recipe_ingredients_yield_pct_range check (yield_pct > 0 and yield_pct <= 100);
exception when duplicate_object then null;
end $$;

alter table public.inventory_items
  add column if not exists grams_per_unit numeric;

create or replace function public.unit_factor(_from text, _to text, _grams_per_unit numeric)
returns numeric language plpgsql immutable as $$
declare _mass constant text[] := array['g','kg'];
declare _vol  constant text[] := array['ml','L'];
declare _mass_to_g jsonb := '{"g":1,"kg":1000}'::jsonb;
declare _vol_to_ml jsonb := '{"ml":1,"L":1000}'::jsonb;
begin
  if _from is null or _to is null or _from = _to then return 1; end if;

  if _from = any(_mass) and _to = any(_mass) then
    return (_mass_to_g->>_from)::numeric / (_mass_to_g->>_to)::numeric;
  end if;
  if _from = any(_vol) and _to = any(_vol) then
    return (_vol_to_ml->>_from)::numeric / (_vol_to_ml->>_to)::numeric;
  end if;

  if _grams_per_unit is null then return null; end if;
  if _from = 'pc' and _to = any(_mass) then
    return _grams_per_unit / (_mass_to_g->>_to)::numeric;
  end if;
  if _to = 'pc' and _from = any(_mass) then
    return (_mass_to_g->>_from)::numeric / _grams_per_unit;
  end if;

  return null; -- e.g. g <-> ml, or pc <-> ml: not reconcilable
end $$;
