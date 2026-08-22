-- ============================================================================
-- 0038 · Fix preorder_orders dedupe index (broke every import)
--
-- 0036 defined preorder_orders_event_external_uidx as a PARTIAL unique index
-- (`where external_id is not null`), meant to let manually-added orders
-- (external_id null) coexist freely. That reasoning was wrong on two counts:
--
--   1. It was unnecessary — a PLAIN unique index already allows unlimited
--      rows with external_id = NULL, because NULL never equals NULL for
--      uniqueness purposes in Postgres. The partial predicate bought nothing.
--
--   2. It was actively broken — every intake route upserts with
--      `ON CONFLICT (event_id, external_id)` (the CSV importer, the
--      website webhook). Postgres cannot match a plain ON CONFLICT column
--      list to a PARTIAL index unless the same WHERE predicate is repeated
--      in the ON CONFLICT clause, which supabase-js's .upsert() has no way
--      to express. Every import has been failing with 42P10 ("no unique or
--      exclusion constraint matching the ON CONFLICT specification"),
--      surfaced in the app as an opaque "Import failed / Unknown error".
--
-- Fix: drop the partial index, replace with a plain one — same columns, same
-- name, no predicate.
-- ============================================================================

drop index if exists public.preorder_orders_event_external_uidx;

create unique index if not exists preorder_orders_event_external_uidx
  on public.preorder_orders (event_id, external_id);
