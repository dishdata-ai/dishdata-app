-- ============================================================================
-- 0045 · Staff role no longer defaults to Dashboard, Orders or Till & Cash
--
-- Staff shouldn't see restaurant-wide figures (Dashboard), the full order
-- ledger (Orders), or the cash drawer (Till & Cash) by default — those stay
-- manager-and-up. This only changes what a NEWLY INVITED staff member gets;
-- existing staff who already have these three keep them until removed
-- per-person on the Team page (this migration does not touch existing
-- member_module_access rows, by design — see 0041's backfill for why that's
-- a deliberate, separate kind of change).
-- ============================================================================

create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  -- compares as ::text so a freshly added enum value ('partner') is usable
  -- within the same transaction that added it
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;
