-- ============================================================================
-- DishData — FULL RESET (DESTRUCTIVE)
-- ----------------------------------------------------------------------------
-- Wipes EVERY organization + all org-scoped data, AND every auth login.
-- Use to start completely fresh, then sign up new accounts via the app.
--
-- Run this in the Supabase SQL editor (it runs as a privileged role).
-- There is NO undo. Take a backup first if you might want the data back.
-- ============================================================================

begin;

-- 1. Org-scoped data: deleting orgs cascades to every table that references
--    orgs(id) ON DELETE CASCADE (recipes, orders, customers, loyalty_*,
--    deliveries, reservations, campaigns, delivery_zones, audit_log, …).
delete from public.orgs;

-- 2. Every login. Cascades to public.profiles (FK on delete cascade).
--    Org membership rows were already removed by step 1.
delete from auth.users;

-- NOTE: stored org assets (logos, bill images) in the `org-assets` bucket are
-- NOT deleted here — Supabase blocks direct DELETE on storage.objects. They're
-- harmless orphans (keyed by old org-id folders). To clear them, use the
-- Storage UI (bucket → select all → delete) or the Storage API. Optional.

commit;

-- Sanity check — all three should be 0.
select
  (select count(*) from public.orgs)        as orgs,
  (select count(*) from auth.users)          as users,
  (select count(*) from public.profiles)     as profiles;
