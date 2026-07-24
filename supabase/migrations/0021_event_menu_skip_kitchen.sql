-- ============================================================================
-- 0021 · Event menus: "food is pre-prepared" (skip the kitchen board)
-- At a popup/event stall the food is largely pre-made and handed over at the
-- counter, so routing every order through New → Preparing → Ready is friction.
-- When an event menu has `skip_kitchen`, the POS marks its orders as `served`
-- at checkout so they never queue on the Kitchen board.
--
-- Implemented POS-side (a status update right after checkout) rather than by
-- adding a parameter to checkout_order — changing that function's signature
-- would create another overload, the same class of bug fixed in 0019.
-- ============================================================================

alter table public.event_menus
  add column if not exists skip_kitchen boolean not null default false;
