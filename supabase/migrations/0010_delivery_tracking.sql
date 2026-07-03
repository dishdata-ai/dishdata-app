-- Delivery order tracking: schema for live rider location + a public
-- (anon) order-status RPC, and extends place_public_order to support
-- delivery/takeaway with server-validated zone fees (today only
-- dine_in is supported, and Kokoland's client-side fee math is
-- unverified — this closes that gap).

-- ----------------------------------------------------------------------------
-- 1. Schema — delivery-specific + live-location columns on `deliveries`
-- ----------------------------------------------------------------------------
alter table public.deliveries add column if not exists postcode text;
alter table public.deliveries add column if not exists delivery_fee numeric(10,2) not null default 0;
alter table public.deliveries add column if not exists current_lat numeric(9,6);
alter table public.deliveries add column if not exists current_lng numeric(9,6);
alter table public.deliveries add column if not exists location_updated_at timestamptz;

-- No RLS changes needed: `deliveries` is already in the generic org-member
-- select/insert/update loop in 0001_init.sql, so dispatchers/managers/riders
-- (as org members) can already read and update these new columns directly.

-- ----------------------------------------------------------------------------
-- 2. place_public_order — add delivery/takeaway support with server-side
--    zone-fee validation. New params are appended with defaults so this
--    replaces the existing function in place (same signature prefix as
--    0006_public_order_return_id.sql) rather than creating an overload.
-- ----------------------------------------------------------------------------
create or replace function public.place_public_order(
  _slug text, _items jsonb, _guest_name text default 'Guest',
  _table_name text default null, _notes text default null,
  _email text default null, _code text default null,
  _order_type text default 'dine_in', _address text default null,
  _postcode text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _rate numeric; _subtotal numeric := 0; _tax numeric; _total numeric; _discount numeric := 0;
  _no int; _order_number text; _order_id uuid; _full_items jsonb := '[]'::jsonb;
  _cust uuid; _voucher jsonb; _prog record; _mult numeric := 1; _earn int := 0;
  _delivery_fee numeric := 0; _zone record;
  it jsonb; r record;
begin
  select id, tax_rate into _org, _rate from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if jsonb_array_length(_items) = 0 or jsonb_array_length(_items) > 50 then raise exception 'invalid order'; end if;

  for it in select * from jsonb_array_elements(_items) loop
    select id, name, price into r from recipes where id = (it->>'recipe_id')::uuid and org_id = _org and is_active = true;
    if not found then raise exception 'item unavailable'; end if;
    _subtotal := _subtotal + r.price * (it->>'qty')::numeric;
    _full_items := _full_items || jsonb_build_object('recipe_id', r.id, 'name', r.name, 'qty', (it->>'qty')::numeric, 'price', r.price);
  end loop;

  if _code is not null and length(trim(_code)) > 0 then
    _voucher := loyalty_voucher_value(_org, _code, _subtotal);
    if (_voucher->>'valid')::boolean then _discount := coalesce((_voucher->>'discount')::numeric,0); end if;
  end if;

  -- Delivery: server-computed fee, never trust a client-submitted amount.
  if _order_type = 'delivery' then
    select * into _zone from delivery_zones
      where org_id = _org and is_active = true
        and lower(regexp_replace(postcode, '\s', '', 'g')) = lower(regexp_replace(coalesce(_postcode, ''), '\s', '', 'g'))
      limit 1;
    if not found then raise exception 'we do not deliver to this postcode yet'; end if;
    if _subtotal < _zone.min_order then
      raise exception 'minimum order for delivery to this postcode is %', _zone.min_order;
    end if;
    _delivery_fee := _zone.delivery_fee;
  end if;

  _tax := round(greatest(_subtotal - _discount, 0) * _rate / 100, 2);
  _total := round(greatest(_subtotal - _discount, 0) + _tax + _delivery_fee, 2);

  if _email is not null and length(trim(_email)) > 0 then
    select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
    if _cust is null then
      insert into customers (org_id, name, email) values (_org, coalesce(nullif(trim(_guest_name),''),'Guest'), lower(_email)) returning id into _cust;
    end if;
  end if;

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, guest_name, customer_id, items, subtotal, tax, total, status, kitchen_status, kitchen_notes, source)
  values (_org, _order_number, _order_type::order_type, _guest_name, _cust, _full_items, _subtotal, _tax, _total, 'open', 'new',
          coalesce('Table: ' || _table_name || '. ', '') || coalesce(_notes, ''), 'storefront')
  returning id into _order_id;

  if _order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, postcode, delivery_fee, status)
    values (_org, _order_id, coalesce(_address, ''), _postcode, _delivery_fee, 'pending');
  end if;

  if _voucher is not null and (_voucher->>'valid')::boolean then
    update loyalty_redemptions set status = 'applied', applied_order_id = _order_id where id = (_voucher->>'redemption_id')::uuid;
  end if;

  if _cust is not null then
    update customers set visits = visits + 1, total_spend = total_spend + _total, last_visit_at = now() where id = _cust;
    select * into _prog from loyalty_programs where org_id = _org;
    if found and _prog.enabled then
      select coalesce((t.perks->>'earn_multiplier')::numeric,1) into _mult
        from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _cust;
      _earn := floor(_total * coalesce(_prog.earn_rate,1) * coalesce(_mult,1))::int;
      if _earn > 0 then
        update customers set points = points + _earn, status_points = status_points + _earn where id = _cust;
        insert into loyalty_transactions (org_id, customer_id, points_delta, reason, order_id, action_type)
          values (_org, _cust, _earn, 'Order ' || _order_number, _order_id, 'purchase');
      end if;
      perform loyalty_recompute_tier(_org, _cust);
    end if;
  end if;

  insert into notifications (org_id, type, title, body, ref)
  values (_org, 'public_order', 'Online order ' || _order_number,
          _guest_name || coalesce(' at table ' || _table_name, '') || ' — pay at counter', 'kitchen');

  return jsonb_build_object(
    'order_number', _order_number, 'total', _total, 'discount', _discount,
    'order_id', _order_id, 'delivery_fee', _delivery_fee
  );
end $$;

grant execute on function public.place_public_order(text,jsonb,text,text,text,text,text,text,text,text) to anon;

-- ----------------------------------------------------------------------------
-- 3. get_public_order_status — read-only tracking for the customer who
--    placed the order. Access control is the unguessable order UUID
--    (the same trust model place_public_order already uses for the
--    order_id it hands back to guests) — there is no listing/enumeration
--    function, so knowing one order's id never reveals any other order.
-- ----------------------------------------------------------------------------
create or replace function public.get_public_order_status(_slug text, _order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _o record; _d record; _result jsonb;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;

  select order_number, order_type, status, kitchen_status, items, total, created_at
    into _o from orders where id = _order_id and org_id = _org;
  if not found then raise exception 'order not found'; end if;

  _result := jsonb_build_object(
    'order_number', _o.order_number, 'order_type', _o.order_type, 'status', _o.status,
    'kitchen_status', _o.kitchen_status, 'items', _o.items, 'total', _o.total, 'created_at', _o.created_at
  );

  if _o.order_type = 'delivery' then
    select status, eta, current_lat, current_lng, location_updated_at
      into _d from deliveries where order_id = _order_id and org_id = _org;
    if found then
      _result := _result || jsonb_build_object(
        'delivery_status', _d.status, 'eta', _d.eta,
        'rider_lat', _d.current_lat, 'rider_lng', _d.current_lng,
        'rider_location_at', _d.location_updated_at
      );
    end if;
  end if;

  return _result;
end $$;

grant execute on function public.get_public_order_status(text, uuid) to anon;

-- ----------------------------------------------------------------------------
-- 4. report_courier_location — rider-only write, scoped to their own
--    assigned delivery. `grant ... to authenticated` alone is NOT the real
--    boundary here — this project grants EXECUTE broadly to anon on all
--    routines by default (see 0001_init.sql) and relies on function logic
--    for access control. The auth.uid()-scoped employee lookup below is
--    what actually rejects anon/unassigned callers; tightened in
--    0011_courier_location_auth_check.sql to fail fast on that instead of
--    incidentally via a later "delivery not found".
-- ----------------------------------------------------------------------------
create or replace function public.report_courier_location(_delivery_id uuid, _lat numeric, _lng numeric)
returns void language plpgsql security definer set search_path = public as $$
declare _emp_id uuid; _d record;
begin
  if _lat < -90 or _lat > 90 or _lng < -180 or _lng > 180 then
    raise exception 'invalid coordinates';
  end if;

  select * into _d from deliveries where id = _delivery_id;
  if not found then raise exception 'delivery not found'; end if;
  if not is_org_member(_d.org_id) then raise exception 'not authorized for this delivery'; end if;

  -- Scope the employee lookup to THIS delivery's org — a person can be
  -- staff at more than one org, and SELECT INTO silently takes the first
  -- row on a multi-row match, so an unscoped lookup could resolve the
  -- wrong employee id and reject the rightly-assigned rider.
  select id into _emp_id from employees where user_id = auth.uid() and org_id = _d.org_id;
  if _emp_id is null then raise exception 'not a recognized employee'; end if;
  if _d.courier_employee_id is distinct from _emp_id then raise exception 'not assigned to this delivery'; end if;

  update deliveries set current_lat = _lat, current_lng = _lng, location_updated_at = now()
  where id = _delivery_id;
end $$;

grant execute on function public.report_courier_location(uuid, numeric, numeric) to authenticated;
