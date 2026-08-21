-- ============================================================================
-- 0037 · Register the "Preorders" module + grant access
-- New web view: the event preorder board (src/views/Preorders.tsx). Mirrors
-- 0022_orders_module.sql exactly — see there for why we only grant to members
-- who ALREADY have explicit per-module rows (a lone row would flip a member
-- into explicit mode and hide every module they get by role default).
-- ============================================================================

insert into public.modules (id, name, grouping, sort)
values ('preorders', 'Preorders', 'Operate', 12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

insert into public.member_module_access (org_id, user_id, module_id, can_access)
select distinct om.org_id, om.user_id, 'preorders', true
from public.org_members om
where exists (
  select 1 from public.member_module_access ma
  where ma.org_id = om.org_id and ma.user_id = om.user_id
)
on conflict (org_id, user_id, module_id) do nothing;
