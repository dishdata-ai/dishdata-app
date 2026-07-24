-- ============================================================================
-- 0019 · Drop the stale 7-arg place_public_order overload
-- place_public_order was first created with 7 args (0006), then re-defined with
-- 10 args (0010, adding delivery _order_type/_address/_postcode). Because
-- `create or replace` only matches an exact signature, BOTH overloads coexisted:
--   • 7-arg (0006) — still had the OLD "add VAT on top" tax logic
--   • 10-arg (0010 → fixed in 0017) — correct VAT-included logic
-- A verification query (pg_get_functiondef ... like '%(100 + _rate)%') exposed
-- the 7-arg version as `false` (unfixed) — a caller resolving to it would be
-- overcharged. The 10-arg version's args 8–10 all have defaults, so it handles
-- every call the 7-arg one did. Drop the stale overload to remove the ambiguity.
-- ============================================================================

drop function if exists public.place_public_order(text, jsonb, text, text, text, text, text);
