-- ============================================================================
-- 0080 · Check-in wording
--
-- The guest's button now means "I'm on my way" (a confirmation that they are
-- really coming), not "I'm 10 minutes away": the kitchen starts cooking from the
-- chosen time minus the chef's prep time, so waiting for a 10-minute signal would
-- be too late. Only the notification text changes.
-- ============================================================================

create or replace function public.guest_check_in(_slug text, _order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; o record;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  select * into o from orders where id = _order_id and org_id = _org and source = 'storefront' for update;
  if not found then raise exception 'order not found'; end if;
  if o.status not in ('open','paid') or o.scheduled_for is null then raise exception 'this order cannot be checked in'; end if;
  if o.checked_in_at is null then
    update orders set checked_in_at = now() where id = o.id;
    insert into notifications (org_id, type, title, body, ref)
    values (_org, 'public_order', 'On the way: ' || o.order_number,
            coalesce(o.guest_name, 'Guest') || ' confirmed they are coming for '
              || to_char(o.scheduled_for at time zone 'Europe/Berlin', 'HH24:MI') || '.', 'kitchen');
  end if;
  return jsonb_build_object('order_number', o.order_number, 'checked_in_at', coalesce(o.checked_in_at, now()), 'first', o.checked_in_at is null);
end $$;
grant execute on function public.guest_check_in(text, uuid) to anon;
