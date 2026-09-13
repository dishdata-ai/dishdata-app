-- ============================================================================
-- 0048 · Staff meal/drink allowance
--
-- A daily € budget staff can spend on food and drinks during their shift,
-- self-served at the till with their own PIN — no manager needed for the
-- common case. Modeled directly on 0033's staff discount (same shape: an
-- org-level limit, per-order attribution, usage computed on demand rather
-- than a stored running counter) but it is its own separate budget:
--
--   orgs.staff_meal_daily_limit   € comped per employee per calendar day
--                                 (null/0 = feature off, the default)
--   orders.staff_meal_amount     how much of THIS order was the free
--                                 allowance (as opposed to a discretionary
--                                 staff_discount_amount) — kept apart so the
--                                 two budgets never mix in reporting or in
--                                 the existing monthly discount cap
--
-- Taking more than the daily allowance is allowed, not blocked — ordering
-- extra, or a parcel to take home, just spends past the free amount and the
-- rest is automatically charged at the org's staff-discount rate
-- (org.staff_discount_max_pct; full price if that's not configured). There
-- is no separate manager-PIN-over-threshold gate on the meal path the way
-- there is on the discretionary discount — the daily cap is the control.
--
-- Identity is verified with the EMPLOYEE'S OWN pin (checkout_order's new
-- _meal_pin param), not the can_approve_discounts manager PIN from 0033 —
-- different question ("is this really you?" vs "who's allowed to approve a
-- large discount?"). Passing _meal_pin is what selects this whole code path;
-- calling checkout_order with _staff_employee_id set and _meal_pin left null
-- keeps 0033's existing "give a friend a discount" behavior byte-for-byte.
--
-- Inventory depletion for a meal-claim order is tagged reason='staff_meal'
-- instead of 'sale', so where the stock actually went is a real, separate
-- line in the inventory ledger rather than folded into revenue-driving sales.
-- ============================================================================

alter table public.orgs
  add column if not exists staff_meal_daily_limit numeric;

alter table public.orders
  add column if not exists staff_meal_amount numeric not null default 0;

do $$ begin alter type inv_reason add value if not exists 'staff_meal'; exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Today's allowance for one employee. The POS calls this to show "€3.20 of
-- €8 left today" before anyone claims a meal.
-- ----------------------------------------------------------------------------
create or replace function public.staff_meal_usage(_org uuid, _employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _used numeric := 0; _limit numeric; _count int := 0;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  select staff_meal_daily_limit into _limit from orgs where id = _org;

  select coalesce(sum(o.staff_meal_amount), 0), count(*)
    into _used, _count
    from orders o
   where o.org_id = _org
     and o.staff_discount_employee_id = _employee
     and o.staff_meal_amount > 0
     and o.status not in ('void', 'refunded')
     and o.created_at >= date_trunc('day', now());

  return jsonb_build_object(
    'used', _used,
    'orders', _count,
    'limit', _limit,
    'remaining', case when coalesce(_limit, 0) <= 0 then 0 else greatest(_limit - _used, 0) end
  );
end $$;

-- ----------------------------------------------------------------------------
-- Per-employee staff-meal totals over a date range, for the Staff page —
-- mirrors staff_discount_report (0033).
-- ----------------------------------------------------------------------------
create or replace function public.staff_meal_report(
  _org uuid,
  _from timestamptz default null,
  _to timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _rows jsonb;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'employee_id', employee_id,
               'employee_name', employee_name,
               'role_title', role_title,
               'orders', order_count,
               'meal_amount', meal_amount,
               'discounted_amount', discounted_amount,
               'revenue', revenue
             ) order by meal_amount desc
           ),
           '[]'::jsonb
         ) into _rows
  from (
    select e.id             as employee_id,
           e.name           as employee_name,
           e.role_title     as role_title,
           count(o.id)      as order_count,
           round(sum(o.staff_meal_amount), 2)     as meal_amount,
           round(sum(o.staff_discount_amount), 2) as discounted_amount,
           round(sum(o.total), 2)                 as revenue
      from orders o
      join employees e on e.id = o.staff_discount_employee_id
     where o.org_id = _org
       and o.staff_meal_amount > 0
       and o.status not in ('void', 'refunded')
       and (_from is null or o.created_at >= _from)
       and (_to   is null or o.created_at <  _to)
     group by e.id, e.name, e.role_title
  ) grouped;

  return _rows;
end $$;

-- ----------------------------------------------------------------------------
-- checkout_order — body from 0033, plus the staff meal branch. Gains one
-- trailing param (_meal_pin), so the 15-arg version is dropped first.
-- ----------------------------------------------------------------------------
drop function if exists public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text);

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
  _discount_pct numeric default 0,
  _employee_id uuid default null,
  _staff_employee_id uuid default null,
  _approval_pin text default null,
  _meal_pin text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0; _tax numeric := 0; _total numeric; _discount numeric := 0; _manual_discount numeric := 0;
  _no int; _order_id uuid; _order_number text; _rate numeric; _line_rate numeric;
  _voucher jsonb; it jsonb; pay jsonb; grp record; _grp_net numeric;
  _items_out jsonb := '[]'::jsonb;
  _prog record; _mult numeric := 1; _earn int := 0;
  _max_pct numeric; _cap numeric; _threshold numeric; _used numeric; _staff record; _pct_of_gross numeric;
  _meal_daily_limit numeric; _meal_used numeric; _meal_amount numeric := 0; _residual numeric;
  _inv_reason text := 'sale';
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  if jsonb_array_length(_items) = 0 then raise exception 'empty order'; end if;

  select tax_rate into _rate from orgs where id = _org;

  -- Snapshot each line's VAT rate (recipe override, else the org default) so
  -- a later recipe edit can never change what an already-placed order shows.
  for it in select * from jsonb_array_elements(_items) loop
    select tax_rate into _line_rate from recipes where id = (it->>'recipe_id')::uuid and org_id = _org;
    _subtotal := _subtotal + (it->>'price')::numeric * (it->>'qty')::numeric;
    _items_out := _items_out || jsonb_build_object(
      'recipe_id', it->>'recipe_id', 'name', it->>'name',
      'qty', (it->>'qty')::numeric, 'price', (it->>'price')::numeric,
      'tax_rate', coalesce(_line_rate, _rate)
    );
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
  -- Ignored entirely on the meal-claim path below, which computes its own.
  _manual_discount := round(
    greatest(coalesce(_discount_amount, 0), 0)
    + (_subtotal * greatest(coalesce(_discount_pct, 0), 0) / 100),
    2
  );
  _manual_discount := least(_manual_discount, _subtotal);

  if _staff_employee_id is not null then
    select * into _staff from employees where id = _staff_employee_id and org_id = _org and is_active;
    if not found then
      raise exception 'staff discount: employee not found or inactive';
    end if;

    if _meal_pin is not null then
      -- ---- Staff meal/drink allowance: self-serve, own-PIN verified -------
      if _staff.pin is null or _staff.pin != _meal_pin then
        raise exception 'PIN doesn''t match — enter your own PIN to confirm it''s you';
      end if;

      select staff_meal_daily_limit into _meal_daily_limit from orgs where id = _org;
      if coalesce(_meal_daily_limit, 0) <= 0 then
        raise exception 'staff meals are not enabled for this restaurant';
      end if;

      select coalesce(sum(o.staff_meal_amount), 0) into _meal_used
        from orders o
       where o.org_id = _org
         and o.staff_discount_employee_id = _staff_employee_id
         and o.staff_meal_amount > 0
         and o.status not in ('void', 'refunded')
         and o.created_at >= date_trunc('day', now());

      _meal_amount := least(_subtotal, greatest(_meal_daily_limit - _meal_used, 0));
      _residual := _subtotal - _meal_amount;

      select staff_discount_max_pct into _max_pct from orgs where id = _org;
      _manual_discount := round(_meal_amount + _residual * greatest(coalesce(_max_pct, 0), 0) / 100, 2);
      _inv_reason := 'staff_meal';
    else
      -- ---- Existing "give a friend a discount" path (0033, unchanged) -----
      select staff_discount_max_pct, staff_discount_monthly_cap, staff_discount_pin_threshold
        into _max_pct, _cap, _threshold
        from orgs where id = _org;

      if coalesce(_max_pct, 0) <= 0 then
        raise exception 'staff discount is not enabled for this restaurant';
      end if;

      if _manual_discount <= 0 then
        raise exception 'staff discount: no discount amount given';
      end if;

      _pct_of_gross := case when _subtotal > 0 then _manual_discount * 100 / _subtotal else 0 end;
      if round(_pct_of_gross, 2) > _max_pct then
        raise exception 'staff discount of % percent exceeds the limit of % percent',
          round(_pct_of_gross, 1), _max_pct;
      end if;

      if _cap is not null then
        select coalesce(sum(o.staff_discount_amount), 0) into _used
          from orders o
         where o.org_id = _org
           and o.staff_discount_employee_id = _staff_employee_id
           and o.status not in ('void', 'refunded')
           and o.created_at >= date_trunc('month', now());
        if _used + _manual_discount > _cap then
          raise exception 'staff discount: % has only % left of a % monthly limit',
            _staff.name, round(greatest(_cap - _used, 0), 2), _cap;
        end if;
      end if;

      if _threshold is not null and _manual_discount > _threshold then
        if _approval_pin is null or not exists (
          select 1 from employees
           where org_id = _org and is_active and can_approve_discounts
             and pin is not null and pin = _approval_pin
        ) then
          raise exception 'staff discount over % needs a manager PIN', _threshold;
        end if;
      end if;
    end if;
  end if;

  _discount := least(_discount + _manual_discount, _subtotal);

  -- VAT extracted per rate group, not once on the whole order — a flat rate
  -- would be wrong the moment an order mixes food and drinks. Any discount is
  -- spread across the groups proportionally to their share of gross.
  for grp in
    select rate, sum(gross) as gross from (
      select coalesce((item.value->>'tax_rate')::numeric, _rate) as rate,
             (item.value->>'price')::numeric * (item.value->>'qty')::numeric as gross
      from jsonb_array_elements(_items_out) item
    ) lines
    group by rate
  loop
    _grp_net := greatest(
      grp.gross - (case when _subtotal > 0 then _discount * grp.gross / _subtotal else 0 end),
      0
    );
    _tax := _tax + round(_grp_net * grp.rate / (100 + grp.rate), 2);
  end loop;

  _total    := round(greatest(_subtotal - _discount, 0) + coalesce(_tip, 0), 2);
  _subtotal := round(greatest(_subtotal - _discount, 0) - _tax, 2);  -- store NET

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, table_id, customer_id, items, subtotal, tax, tip, total, discount,
                      status, kitchen_status, kitchen_notes, employee_id, staff_discount_employee_id, staff_discount_amount,
                      staff_meal_amount)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items_out, _subtotal, _tax, coalesce(_tip,0), _total, _discount,
          case when jsonb_array_length(_payments) > 0 then 'paid'::order_status else 'open'::order_status end,
          'new', _kitchen_notes, _employee_id, _staff_employee_id,
          case when _staff_employee_id is not null then _manual_discount - _meal_amount else 0 end,
          _meal_amount)
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
  select _org, ri.inventory_item_id, ri.name, -sum(ri.qty_numeric * (it.value->>'qty')::numeric), _inv_reason::inv_reason, _order_id
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

grant execute on function public.staff_meal_usage(uuid, uuid) to authenticated;
grant execute on function public.staff_meal_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text, text) to authenticated;
