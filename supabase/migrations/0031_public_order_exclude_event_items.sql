-- ============================================================================
-- 0031 · "(Tournament)" naming was a convention, not a guarantee — several of
-- Kokoland's event-menu dishes (Porotta + * Curry, Chicken Wrap, Uppilittathu,
-- etc.) never got the suffix and kept leaking onto the public menu even after
-- 0028. The real signal for "this is event/POS-only" is membership in
-- event_menu_items, so place_public_order now checks that instead of relying
-- on the name. The one carve-out: an event menu explicitly marked
-- show_on_website replaces the storefront catalog with just its own items
-- (see fetchPublicMenu), so ordering from that specific menu must still work.
-- ============================================================================

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
    select id, name, price into r from recipes
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
