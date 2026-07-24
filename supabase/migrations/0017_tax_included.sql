-- ============================================================================
-- 0017 · VAT-included (gross) pricing — German standard
-- Menu prices already include VAT. Previously the checkout RPCs ADDED tax on
-- top of the price (US model: total = subtotal + subtotal*rate), which
-- overcharged guests by the VAT rate. This re-creates both checkout RPCs so the
-- VAT is computed OUT of the price (herausgerechnet):
--
--     gross  = Σ(price × qty)              -- the menu prices the guest sees
--     tax    = gross × rate / (100 + rate) -- VAT contained within
--     net    = gross − tax                 -- stored as `subtotal`
--     total  = gross (+ tip / + delivery fee)
--
-- The invariant `subtotal + tax = gross` (the price actually charged) is
-- preserved, so every report/screen that reads these columns stays consistent.
-- Only the derivation of subtotal/tax changed — bodies are otherwise verbatim
-- copies of 0002 (checkout_order) and 0010 (place_public_order).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- checkout_order (staff POS) — from 0002_loyalty.sql
-- ----------------------------------------------------------------------------
create or replace function public.checkout_order(
  _org uuid,
  _items jsonb,
  _order_type order_type default 'dine_in',
  _table_id uuid default null,
  _customer_id uuid default null,
  _kitchen_notes text default null,
  _tip numeric default 0,
  _payments jsonb default '[]'::jsonb,
  _address text default null,
  _redemption_code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0; _tax numeric; _total numeric; _discount numeric := 0;
  _no int; _order_id uuid; _order_number text; _rate numeric;
  _voucher jsonb; it jsonb; pay jsonb;
  _prog record; _mult numeric := 1; _earn int := 0;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if jsonb_array_length(_items) = 0 then raise exception 'empty order'; end if;

  select tax_rate into _rate from orgs where id = _org;
  for it in select * from jsonb_array_elements(_items) loop
    _subtotal := _subtotal + (it->>'price')::numeric * (it->>'qty')::numeric;
  end loop;

  -- Optional loyalty voucher
  if _redemption_code is not null and length(trim(_redemption_code)) > 0 then
    _voucher := loyalty_voucher_value(_org, _redemption_code, _subtotal);
    if (_voucher->>'valid')::boolean then
      _discount := coalesce((_voucher->>'discount')::numeric, 0);
    end if;
  end if;

  -- VAT-included (gross) pricing: break VAT out of the price, don't add on top.
  _tax     := round(greatest(_subtotal - _discount, 0) * _rate / (100 + _rate), 2);
  _total   := round(greatest(_subtotal - _discount, 0) + coalesce(_tip, 0), 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, table_id, customer_id, items, subtotal, tax, tip, total, status, kitchen_status, kitchen_notes)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items, _subtotal, _tax, coalesce(_tip,0), _total,
          case when jsonb_array_length(_payments) > 0 then 'paid'::order_status else 'open'::order_status end,
          'new', _kitchen_notes)
  returning id into _order_id;

  -- Mark voucher applied
  if _voucher is not null and (_voucher->>'valid')::boolean then
    update loyalty_redemptions set status = 'applied', applied_order_id = _order_id
      where id = (_voucher->>'redemption_id')::uuid;
  end if;

  for pay in select * from jsonb_array_elements(_payments) loop
    insert into payments (org_id, order_id, method, amount, tip_amount, split_label)
    values (_org, _order_id, (pay->>'method')::payment_method, (pay->>'amount')::numeric,
            coalesce((pay->>'tip_amount')::numeric, 0), pay->>'split_label');
  end loop;

  update inventory_items inv
  set stock = greatest(0, inv.stock - usage.used)
  from (
    select ri.inventory_item_id, sum(ri.qty_numeric * (it.value->>'qty')::numeric) as used
    from jsonb_array_elements(_items) it
    join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
    where ri.inventory_item_id is not null and ri.org_id = _org
    group by ri.inventory_item_id
  ) usage
  where inv.id = usage.inventory_item_id;

  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, ref_order_id)
  select _org, ri.inventory_item_id, ri.name, -sum(ri.qty_numeric * (it.value->>'qty')::numeric), 'sale', _order_id
  from jsonb_array_elements(_items) it
  join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
  where ri.inventory_item_id is not null and ri.org_id = _org
  group by ri.inventory_item_id, ri.name;

  -- Loyalty: configurable earn rate × tier multiplier
  if _customer_id is not null then
    update customers set visits = visits + 1, total_spend = total_spend + _total, last_visit_at = now()
      where id = _customer_id and org_id = _org;
    select * into _prog from loyalty_programs where org_id = _org;
    if found and _prog.enabled then
      select coalesce((t.perks->>'earn_multiplier')::numeric,1) into _mult
        from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _customer_id;
      _earn := floor(_total * coalesce(_prog.earn_rate,1) * coalesce(_mult,1))::int;
      if _earn > 0 then
        update customers set points = points + _earn, status_points = status_points + _earn
          where id = _customer_id and org_id = _org;
        insert into loyalty_transactions (org_id, customer_id, points_delta, reason, order_id, action_type)
          values (_org, _customer_id, _earn, 'Order ' || _order_number, _order_id, 'purchase');
      end if;
      perform loyalty_recompute_tier(_org, _customer_id);
    end if;
  end if;

  if _table_id is not null then
    update restaurant_tables set status = 'seated' where id = _table_id and org_id = _org;
  end if;

  if _order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, status)
    values (_org, _order_id, coalesce(_address, ''), 'pending');
  end if;

  return jsonb_build_object('order_id', _order_id, 'order_number', _order_number, 'total', _total, 'discount', _discount);
end $$;

-- ----------------------------------------------------------------------------
-- place_public_order (anon storefront) — from 0010_delivery_tracking.sql
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

  -- VAT-included (gross) pricing: break VAT out of the food price. The delivery
  -- fee is added to the total as its own gross line (not re-taxed here).
  _tax     := round(greatest(_subtotal - _discount, 0) * _rate / (100 + _rate), 2);
  _total   := round(greatest(_subtotal - _discount, 0) + _delivery_fee, 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

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
