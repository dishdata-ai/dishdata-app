-- ============================================================================
-- 0049 · Let staff set their own PIN
--
-- Until now a PIN was only ever set by a manager, in the Staff page's
-- Add/Edit Employee form — an employee had no way to see or change their
-- own. A PIN someone picks themselves gets remembered; one a manager typed
-- in once during onboarding and never mentioned again doesn't, which just
-- means the staff-meal self-serve (0048) and discount-approval (0033)
-- features it gates quietly stop getting used.
--
-- This can't just widen the employees_member_update policy from 0047 to let
-- a member update their own row — that reopens exactly the hole 0047 closed
-- (a staff account editing its own hourly_rate or is_active). Instead, one
-- narrow function that touches only the pin column of the caller's own
-- linked row, same shape as claim_employee().
-- ============================================================================

create or replace function public.set_my_pin(_org uuid, _pin text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if _pin is not null and length(trim(_pin)) < 4 then
    raise exception 'PIN must be at least 4 digits';
  end if;

  update employees set pin = nullif(trim(_pin), '')
   where org_id = _org and user_id = auth.uid();

  if not found then
    raise exception 'No employee profile linked to your account yet — pick yourself on My Day first.';
  end if;
end $$;

grant execute on function public.set_my_pin(uuid, text) to authenticated;
