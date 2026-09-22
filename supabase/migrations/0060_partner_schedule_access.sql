-- ============================================================================
-- 0060 · Partners can see everyone's availability and manage the schedule
--
-- Reported: a partner opening Staff saw only their own availability (one
-- person's Tuesday) while every other row looked empty. Cause: the
-- staff_availability policy from 0042 lets only owner/admin/manager see other
-- people's rows, and shifts (0044) are writable only by those same roles — but
-- partners (who run the restaurant day to day) get the Staff schedule board in
-- the UI, which invites them to click a day and assign a shift.
--
-- 1. Partners can READ all availability. Writing someone else's availability
--    stays with owner/admin/manager (0042's policy is unchanged).
-- 2. Partners can create/edit/delete shifts, like managers.
--
-- Idempotent. The 'partner' role literal is safe here: it was added to the
-- org_role enum back in 0023, in an earlier transaction.
-- ============================================================================

drop policy if exists staff_availability_partner_select on public.staff_availability;
create policy staff_availability_partner_select on public.staff_availability
  for select using (has_org_role(org_id, 'partner'));

drop policy if exists shifts_manager_write on public.shifts;
create policy shifts_manager_write on public.shifts
  for all
  using (has_org_role(org_id, 'owner', 'admin', 'manager', 'partner'))
  with check (has_org_role(org_id, 'owner', 'admin', 'manager', 'partner'));
