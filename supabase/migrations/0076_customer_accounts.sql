-- ============================================================================
-- 0076 · Customer accounts for the website
--
-- A guest signs in on the restaurant's website with an emailed code (Supabase
-- Auth, no password). Their login is linked to the same `customers` row staff see
-- in DishData, so points, tier, orders and vouchers are one record, not two.
--
--   customers.auth_user_id   the website login this customer record belongs to
--
-- Everything goes through SECURITY DEFINER functions that act only on the
-- signed-in user's own record (auth.uid()): the customers table itself stays
-- staff-only under RLS.
--
-- Linking is by VERIFIED email: the sign-in code proves the guest owns the
-- address, so an existing customer row with that email (from an earlier guest
-- order, the till or a staff entry) is claimed by the login. Otherwise a new
-- customer row is created and the "signup" loyalty bonus is awarded (once).
--
-- Staff accounts are never deleted by delete_my_account (they are org members).
-- ============================================================================

alter table public.customers
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists customers_org_auth_user_idx
  on public.customers (org_id, auth_user_id) where auth_user_id is not null;

-- The signed-in user's customer row for this restaurant (found, claimed by email, or created).
create or replace function public._my_customer(_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _email text; _conf timestamptz; _meta jsonb; _cid uuid; _name text;
begin
  if _uid is null then raise exception 'sign in first'; end if;
  select email, email_confirmed_at, raw_user_meta_data into _email, _conf, _meta from auth.users where id = _uid;
  if _email is null or _conf is null then raise exception 'confirm your email first'; end if;

  select id into _cid from customers where org_id = _org and auth_user_id = _uid;
  if _cid is null then
    select id into _cid from customers
     where org_id = _org and auth_user_id is null and lower(email) = lower(_email)
     order by created_at limit 1;
    if _cid is not null then
      update customers set auth_user_id = _uid where id = _cid;
    else
      _name := coalesce(nullif(trim(_meta->>'full_name'), ''), split_part(_email, '@', 1));
      insert into customers (org_id, name, email, auth_user_id) values (_org, _name, lower(_email), _uid) returning id into _cid;
    end if;
    perform loyalty_award(_org, _cid, 'signup');
    perform loyalty_recompute_tier(_org, _cid);
  end if;
  return _cid;
end $$;
revoke all on function public._my_customer(uuid) from public, anon, authenticated;

create or replace function public.get_my_account(_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _cid uuid; c record; _prog record;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  _cid := _my_customer(_org);
  select * into c from customers where id = _cid;
  select * into _prog from loyalty_programs where org_id = _org;

  return jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'birthday', c.birthday,
      'newsletter_opt_in', c.newsletter_opt_in, 'points', c.points, 'status_points', c.status_points,
      'tier', c.tier, 'tier_id', c.tier_id, 'visits', c.visits, 'total_spend', c.total_spend),
    'program', case when _prog.org_id is null then null else jsonb_build_object(
      'enabled', _prog.enabled, 'points_name', _prog.points_name, 'tier_basis', _prog.tier_basis) end,
    'tiers', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'threshold', t.threshold, 'color', t.color, 'sort_order', t.sort_order) order by t.threshold)
                         from loyalty_tiers t where t.org_id = _org), '[]'::jsonb),
    'rewards', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'description', r.description, 'cost_points', r.cost_points,
                         'reward_type', r.reward_type, 'value', r.value, 'min_tier_id', r.min_tier_id) order by r.sort_order)
                         from loyalty_rewards r where r.org_id = _org and r.enabled), '[]'::jsonb),
    'earn_rules', coalesce((select jsonb_agg(jsonb_build_object('action_type', e.action_type, 'label', e.label, 'points', e.points))
                         from loyalty_earn_rules e where e.org_id = _org and e.enabled and e.action_type <> 'purchase'), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'label', v.reward_snapshot->>'label', 'expires_at', v.expires_at) order by v.created_at desc)
                         from loyalty_redemptions v where v.customer_id = _cid and v.status = 'issued' and (v.expires_at is null or v.expires_at > now())), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
                         select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'order_type', o.order_type, 'total', o.total,
                                'status', o.status, 'payment_state', o.payment_state, 'created_at', o.created_at, 'scheduled_for', o.scheduled_for,
                                'items', o.items, 'party_size', r.party_size) as x
                           from orders o left join reservations r on r.id = o.reservation_id
                          where o.customer_id = _cid and o.org_id = _org and o.status <> 'void'
                          order by o.created_at desc limit 30) q), '[]'::jsonb)
  );
end $$;
revoke all on function public.get_my_account(text) from public, anon;
grant execute on function public.get_my_account(text) to authenticated;

create or replace function public.update_my_account(_slug text, _name text, _phone text, _birthday date, _newsletter boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _org uuid; _cid uuid; _was boolean;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  _cid := _my_customer(_org);
  if _name is null or length(trim(_name)) < 1 then raise exception 'name is required'; end if;
  select newsletter_opt_in into _was from customers where id = _cid;
  update customers set name = trim(_name), phone = nullif(trim(_phone), ''), birthday = _birthday,
         newsletter_opt_in = coalesce(_newsletter, false)
   where id = _cid;
  if coalesce(_newsletter, false) and not coalesce(_was, false) then
    perform loyalty_award(_org, _cid, 'newsletter');
  end if;
end $$;
revoke all on function public.update_my_account(text, text, text, date, boolean) from public, anon;
grant execute on function public.update_my_account(text, text, text, date, boolean) to authenticated;

-- Spend points on a reward; returns the voucher code to enter as the discount code at checkout.
create or replace function public.redeem_my_reward(_slug text, _reward uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _cid uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  _cid := _my_customer(_org);
  return loyalty_redeem(_org, _cid, _reward);
end $$;
revoke all on function public.redeem_my_reward(text, uuid) from public, anon;
grant execute on function public.redeem_my_reward(text, uuid) to authenticated;

-- A copy of everything held about the signed-in guest (GDPR access / portability).
create or replace function public.export_my_data(_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _cid uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  _cid := _my_customer(_org);
  return jsonb_build_object(
    'exported_at', now(),
    'customer', (select to_jsonb(c) - 'org_id' - 'created_by' from customers c where c.id = _cid),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('order_number', o.order_number, 'type', o.order_type, 'items', o.items,
                          'total', o.total, 'status', o.status, 'placed_at', o.created_at, 'scheduled_for', o.scheduled_for) order by o.created_at)
                          from orders o where o.customer_id = _cid), '[]'::jsonb),
    'loyalty_transactions', coalesce((select jsonb_agg(jsonb_build_object('points', t.points_delta, 'reason', t.reason, 'at', t.created_at) order by t.created_at)
                          from loyalty_transactions t where t.customer_id = _cid), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object('code', v.code, 'status', v.status, 'issued_at', v.created_at, 'expires_at', v.expires_at))
                          from loyalty_redemptions v where v.customer_id = _cid), '[]'::jsonb)
  );
end $$;
revoke all on function public.export_my_data(text) from public, anon;
grant execute on function public.export_my_data(text) to authenticated;

-- Delete the signed-in guest's account. Personal details are erased from every
-- customer record linked to this login; orders stay (bookkeeping retention) but lose the name.
-- Refuses for staff: members of any restaurant keep their login.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'sign in first'; end if;
  if exists (select 1 from org_members where user_id = _uid) then
    raise exception 'staff accounts cannot be deleted here';
  end if;
  update orders set guest_name = null
   where customer_id in (select id from customers where auth_user_id = _uid);
  update customers set name = 'Deleted guest', email = null, phone = null, birthday = null,
         instagram_handle = null, newsletter_opt_in = false, auth_user_id = null
   where auth_user_id = _uid;
  delete from auth.users where id = _uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
