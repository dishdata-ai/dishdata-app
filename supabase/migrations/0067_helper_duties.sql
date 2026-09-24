-- ============================================================================
-- 0067 · Split "helper" out as its own duty, on both sides
--
-- Commi / Kitchen Helper was one duty. The user wants Commi and Kitchen
-- Helper as separate duties (different skill level), plus a mirrored
-- Frontend Helper duty for the front-of-house side — not staffed yet, but
-- available for when it gets busier.
--
-- IMPORTANT: run this file ALONE, in its own "Run". Postgres won't let a new
-- enum value be used in the same transaction that adds it — pasting this
-- together with anything that references 'kitchen_helper'/'frontend_helper'
-- (e.g. inserting a duty_assignments row) would fail with "unsafe use of new
-- value of enum type". This file only extends the enum; nothing else needs
-- to change on the database side — duty_assignments.duty and
-- tasks.assigned_role already accept any staff_role value.
-- ============================================================================

alter type public.staff_role add value if not exists 'kitchen_helper';
alter type public.staff_role add value if not exists 'frontend_helper';
