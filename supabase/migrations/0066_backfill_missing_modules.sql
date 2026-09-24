-- ============================================================================
-- 0066 · Backfill missing modules rows (till, payroll)
--
-- 0061_backfill_new_module_access.sql failed live with:
--   insert or update on table "member_module_access" violates foreign key
--   constraint "member_module_access_module_id_fkey"
--   DETAIL: Key (module_id)=(till) is not present in table "modules".
--
-- Confirmed by diffing the live `modules` table against src/lib/modules.ts:
-- 'till' (from an early setup.sql seed block) and 'payroll' (from 0014) were
-- never actually inserted on this database, even though both are referenced
-- by default_modules_for_role() and by the frontend module registry. This
-- database's migration history has gaps from being applied piecemeal rather
-- than as one full ordered replay — this patches the specific gap blocking
-- 0061. Idempotent; safe to re-run.
-- ============================================================================

insert into public.modules (id, name, grouping, sort)
values
  ('till', 'Till & Cash', 'Money', 15),
  ('payroll', 'Payroll', 'People', 23)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;
