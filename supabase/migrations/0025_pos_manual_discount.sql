-- ============================================================================
-- 0025 · POS manual discount (flat amount or %) at checkout
-- Staff can apply a discount at checkout — a flat € amount or a % off the
-- order — same treatment as a loyalty voucher discount (subtracted from the
-- gross before VAT is broken out), just staff-entered instead of redeemed by
-- code. Both can combine with a voucher; the total discount is capped so it
-- never exceeds the order's gross value. Stored on the order for reporting.
--
-- checkout_order's signature gains two params, so `create or replace` alone
-- would leave the old 10-arg version as a stale duplicate overload rather
-- than truly replacing it — see 0019 for the bug that pattern caused. Drop
-- the old signature first.
--
-- Run this BEFORE deploying the client code that calls it — the client
-- always sends the two new args, so if this hasn't run yet every checkout
-- (not just discounted ones) will fail with "function does not exist".
-- ============================================================================

alter table public.orders add column if not exists discount numeric not null default 0;

drop function if exists public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text);

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
  _redemption_code text default null,
  _discount_amount numeric default 0,
  _discount_pct numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0; _tax numeric; _total numeric; _discount numeric := 0; _manual_discount numeric := 0;
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

  -- Manual staff discount (flat € + %), on top of any voucher, capped to the
  -- order's gross so a heavy-handed discount can never make the order negative.
  _manual_discount := round(
    greatest(coalesce(_discount_amount, 0), 0)
    + (_subtotal * greatest(coalesce(_discount_pct, 0), 0) / 100),
    2
  );
  _discount := least(_discount + _manual_discount, _subtotal);

  -- VAT-included (gross) pricing: break VAT out of the price, don't add on top.
  _tax     := round(greatest(_subtotal - _discount, 0) * _rate / (100 + _rate), 2);
  _total   := round(greatest(_subtotal - _discount, 0) + coalesce(_tip, 0), 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, table_id, customer_id, items, subtotal, tax, tip, total, discount, status, kitchen_status, kitchen_notes)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items, _subtotal, _tax, coalesce(_tip,0), _total, _discount,
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
