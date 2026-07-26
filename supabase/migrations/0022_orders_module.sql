-- ============================================================================
-- 0022 · Register the "Orders" module + grant access
-- New web view: a full, searchable order-history list (src/views/Orders.tsx).
-- Access is resolved as `enabled_modules ∩ member_module_access`. The code
-- force-enables "orders" at the org level (like loyalty/marketing were, for
-- modules added after onboarding); this migration handles the member gate.
--
-- member_module_access.module_id has an FK to modules(id), so the module must
-- be registered first. We then grant "orders" ONLY to members who already have
-- explicit per-module rows — members with no rows fall back to their role's
-- default set (which now includes "orders"), so we must NOT create a lone row
-- for them (that would flip them into explicit mode and hide everything else).
-- ============================================================================

insert into public.modules (id, name, grouping, sort)
values ('orders', 'Orders', 'Operate', 11)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

insert into public.member_module_access (org_id, user_id, module_id, can_access)
select distinct om.org_id, om.user_id, 'orders', true
from public.org_members om
where exists (
  select 1 from public.member_module_access ma
  where ma.org_id = om.org_id and ma.user_id = om.user_id
)
on conflict (org_id, user_id, module_id) do nothing;
