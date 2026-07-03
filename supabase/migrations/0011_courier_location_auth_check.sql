-- Tighten report_courier_location (from 0010_delivery_tracking.sql): reject
-- unauthenticated callers immediately, before any DB lookup.
--
-- This project's convention (see the blanket `alter default privileges ...
-- grant all on routines to anon` in 0001_init.sql) grants EXECUTE on all
-- functions broadly and relies on function logic — not the GRANT — for
-- access control. `grant execute ... to authenticated` on the original
-- 0010 function was therefore not actually restrictive on its own: an
-- anon caller could still invoke it and would only fail later, on the
-- "delivery not found" check for a bogus id, rather than an explicit
-- auth rejection. Confirmed by testing against big-brewsky (the test
-- org) after 0010 was applied. The auth.uid()-scoped employee check
-- further down already prevented any actual write by an anon caller —
-- this change just makes the rejection immediate and explicit instead
-- of incidental.
create or replace function public.report_courier_location(_delivery_id uuid, _lat numeric, _lng numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _emp_id uuid; _d record;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then
    raise exception 'invalid coordinates';
  end if;

  select * into _d from deliveries where id = _delivery_id;
  if not found then raise exception 'delivery not found'; end if;
  if not is_org_member(_d.org_id) then raise exception 'not authorized for this delivery'; end if;

  select id into _emp_id from employees where user_id = auth.uid() and org_id = _d.org_id;
  if _emp_id is null then raise exception 'not a recognized employee'; end if;
  if _d.courier_employee_id is distinct from _emp_id then raise exception 'not assigned to this delivery'; end if;

  update deliveries set current_lat = _lat, current_lng = _lng, location_updated_at = now()
  where id = _delivery_id;
end $$;

grant execute on function public.report_courier_location(uuid, numeric, numeric) to authenticated;
