-- ============================================================================
-- 0029 · Recipe descriptions — shown under the name on the public menu.
-- ============================================================================

alter table public.recipes add column if not exists description text;
