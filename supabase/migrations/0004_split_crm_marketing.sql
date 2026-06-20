-- ============================================================================
-- DishData - Split "Loyalty & CRM" into Customers (id stays 'crm') + Marketing.
-- Run AFTER 0001-0003. Idempotent; ASCII-only so pasting is safe.
-- ============================================================================

-- Rename the existing module (keep id 'crm' so member_module_access stays valid)
update public.modules set name = 'Customers' where id = 'crm';

-- New Marketing module
insert into public.modules (id, name, grouping, sort) values ('marketing','Marketing','Grow',13)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;

-- Default module access per role (managers get crm + loyalty + marketing; owner/admin get all)
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','loyalty','marketing','zreport']
    when 'staff' then array['dashboard','myday','pos','kitchen','floor','timeclock','tasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

-- Backfill Marketing access for existing owners/admins/managers
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, 'marketing', true from public.org_members om
where om.role in ('owner','admin','manager')
on conflict (org_id, user_id, module_id) do nothing;
