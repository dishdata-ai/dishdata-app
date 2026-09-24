-- ============================================================================
-- 0061 · Re-run the member_module_access backfill (dailytasks, kitchenops)
--
-- Confirmed live (2026-09-23): zero member_module_access rows exist for
-- 'dailytasks' or 'kitchenops', for any member, in any org — so nobody sees
-- either module even though the org-level settings and ALWAYS_ENABLED_MODULES
-- both say they're on.
--
-- Root cause: `grant_new_module_to_existing_members()` (0041) only fires on a
-- genuine first INSERT of a module row. Both of these modules' rows were
-- created early, before `default_modules_for_role()` was updated to include
-- them for manager/staff (that happened across 0045/0055/0056/0059/0060) —
-- so the trigger fired once, using a role-default list that didn't grant
-- them to anyone, and every later migration's `insert ... on conflict do
-- update` just re-confirms the same row without ever re-triggering the
-- grant. Any module can end up in this state whenever its row exists before
-- its role-default list is finalized.
--
-- Fix: exactly 0041's one-time backfill, safe to re-run — `on conflict do
-- nothing` only fills gaps against the CURRENT default_modules_for_role(),
-- it can never touch a right someone was deliberately given or an access an
-- admin deliberately revoked.
-- ============================================================================

insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, m, true
from public.org_members om, unnest(public.default_modules_for_role(om.role)) as m
on conflict (org_id, user_id, module_id) do nothing;
