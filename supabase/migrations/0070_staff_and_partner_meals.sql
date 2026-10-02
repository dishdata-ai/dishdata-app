-- ============================================================================
-- 0070 · Staff meal rules (working-day credit, 2-drink cap, two rates) + partner meals
--
-- Kokoland's policy: on a day an employee works, they get a free €10 credit
-- (the existing staff_meal_daily_limit) that may cover food plus at most 2
-- drinks, and anything beyond it is 40% off. On a day they don't work there is
-- no credit — everything is 30% off. 0048 already had the free credit and a
-- single discount rate; this adds the three rules it was missing:
--
--   orgs.staff_meal_pct_working  % off the rest of the order on a working day
--                                (null = fall back to staff_discount_max_pct,
--                                 i.e. exactly what 0048 did)
--   orgs.staff_meal_pct_off      % off the whole order on a day the employee
--                                did NOT clock in; setting it is what turns the
--                                working-day rule on (null = every day counts
--                                as a working day, i.e. exactly what 0048 did)
--   orgs.staff_meal_free_drinks  most drinks the free credit may cover per
--                                employee per day (null = no cap)
--   orders.staff_meal_drinks     drinks this order's free credit covered, so
--                                the daily cap is a sum, not a stored counter
--
-- "Working day" = a time_entries row with clock_in today. Shifts are not used:
-- the schedule is barely filled in, the time clock is what people actually use.
-- "Today" is date_trunc('day', now()), the same boundary 0048's credit uses.
--
-- A drink is a recipe whose category is Beverages / Drinks (see is_drink_category).
-- The credit is spent on food first, then on drinks in cart order, so food is
-- never starved by a drink and the cap only ever limits drinks.
--
-- An org that sets none of the three new columns behaves exactly as under 0048.
-- Only the staff-meal branch of checkout_order changed; the signature is the
-- same 16 arguments, so this is a plain create-or-replace.
--
-- PARTNER MEALS (second half of this file): partners — whoever can_see_partner_tasks(),
-- i.e. owner / admin / partner — get a monthly number of completely free meals.
--   orgs.partner_meal_monthly_count   free meals per partner per calendar month (null/0 = off)
--   orgs.partner_meal_max_value       optional € ceiling on one free meal; the rest is paid at full
--                                     price (null = the whole order is free)
--   orders.partner_meal_user_id       which partner's quota paid for it (their login, auth.uid())
--   orders.partner_meal_amount        € comped
-- A meal is one order. Identity is the signed-in session, never a parameter, so a partner can
-- only claim for themselves and nobody else can claim on their behalf. When the monthly meals
-- are used up the claim is refused and the partner just rings the order up normally.
-- checkout_order gains a 17th argument (_partner_meal, default false), which changes its
-- signature, so the 16-argument version is dropped first; existing 16-argument callers still
-- resolve because the new argument has a default.
-- ============================================================================

alter table public.orgs
  add column if not exists staff_meal_pct_working numeric,
  add column if not exists staff_meal_pct_off numeric,
  add column if not exists staff_meal_free_drinks integer;

alter table public.orders
  add column if not exists staff_meal_drinks integer not null default 0;

alter table public.orgs
  add column if not exists partner_meal_monthly_count integer,
  add column if not exists partner_meal_max_value numeric;

alter table public.orders
  add column if not exists partner_meal_user_id uuid references auth.users(id) on delete set null,
  add column if not exists partner_meal_amount numeric not null default 0;

create index if not exists orders_partner_meal_idx
  on public.orders (org_id, partner_meal_user_id, created_at)
  where partner_meal_user_id is not null;

-- Which menu categories count as drinks for the free-drink cap. One place to change.
create or replace function public.is_drink_category(_cat text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(_cat, ''))) in ('beverages', 'beverage', 'drinks', 'drink', 'getränke');
$$;

-- How much of an order the free credit covers. Credit goes to food first, then to drinks in
-- cart order (each drink needs a free-drink slot while a cap applies). _free_drinks null = no cap.
create or replace function public.staff_meal_split(_org uuid, _items jsonb, _credit numeric, _free_drinks int)
returns table (meal_amount numeric, drinks int)
language plpgsql stable set search_path = public as $$
declare
  it jsonb; _cat text; _price numeric; _qty int;
  _food numeric := 0; _left numeric := greatest(coalesce(_credit, 0), 0);
  _meal numeric := 0; _used int := 0; _slots int := _free_drinks; _i int;
begin
  for it in select * from jsonb_array_elements(_items) loop
    select category into _cat from recipes where id = (it->>'recipe_id')::uuid and org_id = _org;
    if not is_drink_category(_cat) then
      _food := _food + (it->>'price')::numeric * (it->>'qty')::numeric;
    end if;
  end loop;

  _meal := least(_food, _left);
  _left := _left - _meal;

  for it in select * from jsonb_array_elements(_items) loop
    select category into _cat from recipes where id = (it->>'recipe_id')::uuid and org_id = _org;
    continue when not is_drink_category(_cat);
    _price := (it->>'price')::numeric;
    _qty := greatest(floor((it->>'qty')::numeric), 0)::int;
    for _i in 1.._qty loop
      exit when _left <= 0 or (_slots is not null and _slots <= 0);
      _meal := _meal + least(_price, _left);
      _left := _left - least(_price, _left);
      _used := _used + 1;
      if _slots is not null then _slots := _slots - 1; end if;
    end loop;
  end loop;

  meal_amount := _meal;
  drinks := _used;
  return next;
end $$;

-- Today's allowance for one employee — what the till and My Day show before anyone claims.
create or replace function public.staff_meal_usage(_org uuid, _employee uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  _used numeric := 0; _limit numeric; _count int := 0; _drinks int := 0;
  _free_drinks int; _pct_off numeric; _pct_working numeric; _working boolean := true;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  select staff_meal_daily_limit, staff_meal_free_drinks, staff_meal_pct_off,
         coalesce(staff_meal_pct_working, staff_discount_max_pct)
    into _limit, _free_drinks, _pct_off, _pct_working
    from orgs where id = _org;

  select coalesce(sum(o.staff_meal_amount), 0), count(*), coalesce(sum(o.staff_meal_drinks), 0)
    into _used, _count, _drinks
    from orders o
   where o.org_id = _org
     and o.staff_discount_employee_id = _employee
     and o.staff_meal_amount > 0
     and o.status not in ('void', 'refunded')
     and o.created_at >= date_trunc('day', now());

  if _pct_off is not null then
    _working := exists (
      select 1 from time_entries te
       where te.org_id = _org and te.employee_id = _employee
         and te.clock_in >= date_trunc('day', now())
    );
  end if;

  return jsonb_build_object(
    'used', _used,
    'orders', _count,
    'limit', _limit,
    'remaining', case when coalesce(_limit, 0) <= 0 or not _working then 0 else greatest(_limit - _used, 0) end,
    'working_today', _working,
    'pct', coalesce(case when _working then _pct_working else _pct_off end, 0),
    'drinks_used', _drinks,
    'drinks_limit', _free_drinks,
    'drinks_remaining', case when _free_drinks is null then null else greatest(_free_drinks - _drinks, 0) end
  );
end $$;

-- This partner's free meals for the current calendar month — what the till and My Day show.
-- Counts orders, not a stored counter, so a voided or refunded meal gives its slot back.
create or replace function public.partner_meal_usage(_org uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _count int; _max numeric; _used int := 0; _eligible boolean;
begin
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;
  _eligible := can_see_partner_tasks(_org);
  select partner_meal_monthly_count, partner_meal_max_value into _count, _max from orgs where id = _org;
  select count(*) into _used
    from orders o
   where o.org_id = _org
     and o.partner_meal_user_id = auth.uid()
     and o.status not in ('void', 'refunded')
     and o.created_at >= date_trunc('month', now());
  return jsonb_build_object(
    'eligible', _eligible,
    'count', _count,
    'max_value', _max,
    'used', _used,
    'remaining', case when not _eligible or coalesce(_count, 0) <= 0 then 0 else greatest(_count - _used, 0) end
  );
end $$;

-- checkout_order — body from 0048; the staff-meal branch changed and a partner-meal branch was added.
-- The signature gained a 17th argument, so the 16-argument version has to go first.
drop function if exists public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text, text);
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
  _meal_pin text default null,
  _partner_meal boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _subtotal numeric := 0; _tax numeric := 0; _total numeric; _discount numeric := 0; _manual_discount numeric := 0;
  _no int; _order_id uuid; _order_number text; _rate numeric; _line_rate numeric;
  _voucher jsonb; it jsonb; pay jsonb; grp record; _grp_net numeric;
  _items_out jsonb := '[]'::jsonb;
  _prog record; _mult numeric := 1; _earn int := 0;
  _max_pct numeric; _cap numeric; _threshold numeric; _used numeric; _staff record; _pct_of_gross numeric;
  _meal_daily_limit numeric; _meal_used numeric; _meal_amount numeric := 0; _residual numeric;
  _meal_drinks int := 0; _drinks_used int := 0; _free_drinks int; _pct_working numeric; _pct_off numeric;
  _working boolean := true; _rate_pct numeric; _split record;
  _partner_count int; _partner_max numeric; _partner_used int; _partner_free numeric := 0;
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

      select staff_meal_daily_limit, staff_meal_free_drinks, staff_meal_pct_off,
             coalesce(staff_meal_pct_working, staff_discount_max_pct)
        into _meal_daily_limit, _free_drinks, _pct_off, _pct_working
        from orgs where id = _org;
      if coalesce(_meal_daily_limit, 0) <= 0 then
        raise exception 'staff meals are not enabled for this restaurant';
      end if;

      -- Setting an off-day rate is what switches the working-day rules on: the free credit (and its
      -- drink cap) then needs a clock-in today, and a day off is the off-day rate instead. An org
      -- that never set one keeps the old behaviour exactly: credit any day, no drink cap.
      if _pct_off is not null then
        _working := exists (
          select 1 from time_entries te
           where te.org_id = _org and te.employee_id = _staff_employee_id
             and te.clock_in >= date_trunc('day', now())
        );
      end if;

      if _working then
        select coalesce(sum(o.staff_meal_amount), 0), coalesce(sum(o.staff_meal_drinks), 0)
          into _meal_used, _drinks_used
          from orders o
         where o.org_id = _org
           and o.staff_discount_employee_id = _staff_employee_id
           and o.staff_meal_amount > 0
           and o.status not in ('void', 'refunded')
           and o.created_at >= date_trunc('day', now());

        select * into _split from staff_meal_split(
          _org, _items,
          greatest(_meal_daily_limit - _meal_used, 0),
          case when _free_drinks is null then null else greatest(_free_drinks - _drinks_used, 0) end
        );
        _meal_amount := _split.meal_amount;
        _meal_drinks := _split.drinks;
        _rate_pct := _pct_working;
      else
        _rate_pct := _pct_off;
      end if;

      _residual := _subtotal - _meal_amount;
      _manual_discount := round(_meal_amount + _residual * greatest(coalesce(_rate_pct, 0), 0) / 100, 2);
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

  -- Partner meal: one of the signed-in partner's free meals this month. Overrides any manual discount sent.
  if _partner_meal then
    if _staff_employee_id is not null then
      raise exception 'a partner meal can''t be combined with a staff discount or staff meal';
    end if;
    if not can_see_partner_tasks(_org) then
      raise exception 'partner meals are only for partners';
    end if;
    select partner_meal_monthly_count, partner_meal_max_value into _partner_count, _partner_max
      from orgs where id = _org;
    if coalesce(_partner_count, 0) <= 0 then
      raise exception 'partner meals are not enabled for this restaurant';
    end if;
    select count(*) into _partner_used
      from orders o
     where o.org_id = _org
       and o.partner_meal_user_id = auth.uid()
       and o.status not in ('void', 'refunded')
       and o.created_at >= date_trunc('month', now());
    if _partner_used >= _partner_count then
      raise exception 'no free partner meals left this month (% of % used)', _partner_used, _partner_count;
    end if;
    _partner_free := least(_subtotal, coalesce(_partner_max, _subtotal));
    _manual_discount := _partner_free;
    _inv_reason := 'staff_meal';
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
                      staff_meal_amount, staff_meal_drinks, partner_meal_user_id, partner_meal_amount)
  values (_org, _order_number, _order_type, _table_id, _customer_id, _items_out, _subtotal, _tax, coalesce(_tip,0), _total, _discount,
          case when jsonb_array_length(_payments) > 0 then 'paid'::order_status else 'open'::order_status end,
          'new', _kitchen_notes, _employee_id, _staff_employee_id,
          case when _staff_employee_id is not null then _manual_discount - _meal_amount else 0 end,
          _meal_amount, _meal_drinks, case when _partner_meal then auth.uid() end, _partner_free)
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

grant execute on function public.staff_meal_split(uuid, jsonb, numeric, int) to authenticated;
grant execute on function public.staff_meal_usage(uuid, uuid) to authenticated;
grant execute on function public.partner_meal_usage(uuid) to authenticated;
grant execute on function public.checkout_order(uuid, jsonb, order_type, uuid, uuid, text, numeric, jsonb, text, text, numeric, numeric, uuid, uuid, text, text, boolean) to authenticated;

-- Kokoland Berlin's policy. Only fills a blank, so a later change in Settings is never overwritten.
update public.orgs set staff_meal_pct_working = 40 where name = 'Kokoland Berlin' and staff_meal_pct_working is null;
update public.orgs set staff_meal_pct_off = 30 where name = 'Kokoland Berlin' and staff_meal_pct_off is null;
update public.orgs set staff_meal_free_drinks = 2 where name = 'Kokoland Berlin' and staff_meal_free_drinks is null;
