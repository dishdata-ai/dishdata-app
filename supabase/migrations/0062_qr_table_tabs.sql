-- ============================================================================
-- 0062 · One running tab per table for QR orders
--
-- Every QR submission inserted its own order, and never set orders.table_id —
-- the table survived only as free text inside kitchen_notes ("Table: T1."). So
-- one table ordering three times produced three bills (really happened:
-- ORD-0485/0486/0487, all T1, within two minutes), and nothing downstream —
-- Floor, POS, reporting — could group by table at all.
--
-- Now a dine-in QR order looks for an unpaid order already open at that table
-- from this sitting and adds its items to it, and every new order records a
-- real table_id.
--
-- Deliberately NOT tabbed:
--   * takeaway and delivery — each is its own collection, and "Takeaway" is a
--     real row in restaurant_tables, so it is excluded by name as well as by
--     order_type in case a client ever sends the wrong one;
--   * any order carrying a loyalty voucher — a discount is priced against one
--     order's subtotal, and folding a discounted submission into an existing
--     tab would silently re-apply it across the whole bill.
--
-- The six-hour window is what separates "this sitting" from the 73 stale open
-- orders already in the table; those also all have table_id null, so they can
-- never be matched by the lookup below.
-- ============================================================================

create or replace function public.place_public_order(
  _slug text, _items jsonb, _guest_name text default 'Guest',
  _table_name text default null, _notes text default null,
  _email text default null, _code text default null,
  _order_type text default 'dine_in', _address text default null,
  _postcode text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _rate numeric; _subtotal numeric := 0; _tax numeric := 0; _total numeric; _discount numeric := 0;
  _no int; _order_number text; _order_id uuid; _full_items jsonb := '[]'::jsonb;
  _cust uuid; _voucher jsonb; _prog record; _mult numeric := 1; _earn int := 0;
  _delivery_fee numeric := 0; _zone record; grp record; _grp_net numeric;
  it jsonb; r record;
  _table_id uuid; _tab record; _merged jsonb; _idx int; i int; _appended boolean := false; _tab_total numeric;
begin
  select id, tax_rate into _org, _rate from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if jsonb_array_length(_items) = 0 or jsonb_array_length(_items) > 50 then raise exception 'invalid order'; end if;

  for it in select * from jsonb_array_elements(_items) loop
    select id, name, price, tax_rate into r from recipes
      where id = (it->>'recipe_id')::uuid and org_id = _org and is_active = true
        and (sold_out_until is null or sold_out_until <= now())
        and name not ilike '%(Tournament)%'
        and (
          not exists (select 1 from event_menu_items emi where emi.recipe_id = recipes.id)
          or exists (
            select 1 from event_menu_items emi
            join event_menus em on em.id = emi.event_menu_id
            where emi.recipe_id = recipes.id
              and em.org_id = _org and em.is_active = true and em.show_on_website = true
          )
        );
    if not found then raise exception 'item unavailable'; end if;
    _subtotal := _subtotal + r.price * (it->>'qty')::numeric;
    _full_items := _full_items || jsonb_build_object(
      'recipe_id', r.id, 'name', r.name, 'qty', (it->>'qty')::numeric, 'price', r.price,
      'tax_rate', coalesce(r.tax_rate, _rate)
    );
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

  -- VAT extracted per rate group (see checkout_order) — the delivery fee is
  -- added to the total as its own gross line, not re-taxed here.
  for grp in
    select rate, sum(gross) as gross from (
      select coalesce((item.value->>'tax_rate')::numeric, _rate) as rate,
             (item.value->>'price')::numeric * (item.value->>'qty')::numeric as gross
      from jsonb_array_elements(_full_items) item
    ) lines
    group by rate
  loop
    _grp_net := greatest(
      grp.gross - (case when _subtotal > 0 then _discount * grp.gross / _subtotal else 0 end),
      0
    );
    _tax := _tax + round(_grp_net * grp.rate / (100 + grp.rate), 2);
  end loop;

  _total    := round(greatest(_subtotal - _discount, 0) + _delivery_fee, 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  if _email is not null and length(trim(_email)) > 0 then
    select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
    if _cust is null then
      insert into customers (org_id, name, email) values (_org, coalesce(nullif(trim(_guest_name),''),'Guest'), lower(_email)) returning id into _cust;
    end if;
  end if;

  -- The QR code carries a table NAME; everything downstream wants the id.
  if _order_type = 'dine_in' and _table_name is not null and length(trim(_table_name)) > 0 then
    select id into _table_id from restaurant_tables
     where org_id = _org
       and lower(name) = lower(trim(_table_name))
       and lower(name) <> 'takeaway'
     limit 1;
  end if;

  -- An unpaid order already open at this table, from this sitting.
  if _table_id is not null and _discount = 0 then
    select o.id, o.order_number, o.items into _tab
      from orders o
     where o.org_id = _org and o.table_id = _table_id and o.source = 'storefront'
       and o.status = 'open' and o.created_at > now() - interval '6 hours'
     order by o.created_at desc
     limit 1;
    _appended := found;
  end if;

  if _appended then
    -- Fold the new lines into the tab: same dish at the same price bumps its
    -- quantity, anything else joins as a new line. A bumped line loses its
    -- `ready` tick, because the extra portions still have to be cooked.
    _merged := _tab.items;
    for it in select * from jsonb_array_elements(_full_items) loop
      _idx := null;
      for i in 0 .. jsonb_array_length(_merged) - 1 loop
        if _merged->i->>'recipe_id' = it->>'recipe_id'
           and coalesce((_merged->i->>'price')::numeric, 0) = coalesce((it->>'price')::numeric, 0) then
          _idx := i; exit;
        end if;
      end loop;
      if _idx is null then
        _merged := _merged || it;
      else
        _merged := jsonb_set(
          _merged, array[_idx::text],
          (_merged->_idx) - 'ready'
            || jsonb_build_object('qty', (_merged->_idx->>'qty')::numeric + (it->>'qty')::numeric)
        );
      end if;
    end loop;

    update orders set
      items          = _merged,
      subtotal       = subtotal + _subtotal,
      tax            = tax + _tax,
      total          = total + _total,
      -- Food just arrived on a tab the kitchen had finished, so it goes back
      -- on the board rather than sitting silently as ready/served.
      kitchen_status = case when kitchen_status in ('ready','served')
                            then 'preparing'::kitchen_status else kitchen_status end,
      kitchen_notes  = coalesce(kitchen_notes, '') || coalesce(' + ' || nullif(trim(_notes), ''), ''),
      customer_id    = coalesce(customer_id, _cust)
    where id = _tab.id
    returning total into _tab_total;

    _order_id := _tab.id;
    _order_number := _tab.order_number;
  else
    update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
    _order_number := 'ORD-' || lpad(_no::text, 4, '0');

    insert into orders (org_id, order_number, order_type, guest_name, customer_id, table_id, items, subtotal, tax, total, status, kitchen_status, kitchen_notes, source)
    values (_org, _order_number, _order_type::order_type, _guest_name, _cust, _table_id, _full_items, _subtotal, _tax, _total, 'open', 'new',
            coalesce('Table: ' || _table_name || '. ', '') || coalesce(_notes, ''), 'storefront')
    returning id into _order_id;
  end if;

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
  values (_org, 'public_order',
          case when _appended then 'Added to ' || _order_number else 'Online order ' || _order_number end,
          _guest_name || coalesce(' at table ' || _table_name, '')
            || case when _appended then ' — more items on the tab' else ' — pay at counter' end,
          'kitchen');

  return jsonb_build_object(
    'order_number', _order_number,
    -- What the whole table now owes, so a second round doesn't show the guest
    -- only that round's price. Loyalty above still earns on _total, which is
    -- the amount actually added.
    'total', case when _appended then _tab_total else _total end,
    'discount', _discount,
    'order_id', _order_id, 'delivery_fee', _delivery_fee, 'appended', _appended
  );
end $$;

grant execute on function public.place_public_order(text,jsonb,text,text,text,text,text,text,text,text) to anon;
