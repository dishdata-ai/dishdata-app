-- ============================================================================
-- 0009 — Full demo seed extras
-- ----------------------------------------------------------------------------
-- seed_demo_data() (0001) covers recipes, inventory, vendors, tables, staff,
-- customers, ~2 weeks of paid orders, POs and expenses. create_organization()
-- auto-seeds the loyalty program. This migration adds the *remaining* feature
-- areas so a demo org exercises EVERY module:
--   reservations · deliveries + delivery zones · timeclock · marketing
--   campaigns · supplier bills + price intelligence · loyalty history &
--   redemptions · notifications · PO line items · inventory movements.
--
-- Idempotent (guards on reservations). Designed to run AFTER seed_demo_data —
-- the app's "load sample data" onboarding step calls both.
-- ============================================================================

create or replace function public.seed_demo_extras(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  emp_chef uuid; emp_mgr uuid; emp_server uuid; emp_bar uuid; emp_courier uuid;
  t_bronze uuid; t_silver uuid; t_gold uuid; t_plat uuid;
  rw_id uuid;
  v_ocean uuid; v_green uuid; v_prime uuid;
  inv_salmon uuid; inv_cod uuid; inv_tom uuid; inv_rice uuid;
  c_olivia uuid; c_marcus uuid;
  bill_id uuid; o_id uuid; _no int; i int; rec record;
begin
  if auth.uid() is not null and not has_org_role(_org, 'owner', 'admin') then
    raise exception 'admin only';
  end if;
  if exists (select 1 from reservations where org_id = _org) then return; end if; -- already extended

  -- Existing seeded references (best-effort lookups by the 0001 demo names) ----
  select id into emp_chef    from employees where org_id=_org and role_title ilike '%chef%'       order by created_at limit 1;
  select id into emp_mgr     from employees where org_id=_org and role_title ilike '%manager%'    limit 1;
  select id into emp_server  from employees where org_id=_org and role_title ilike '%server%'     limit 1;
  select id into emp_bar     from employees where org_id=_org and role_title ilike '%bartender%'  limit 1;
  emp_courier := coalesce(emp_server, emp_bar, emp_chef);

  select id into t_bronze from loyalty_tiers where org_id=_org and name='Bronze'   limit 1;
  select id into t_silver from loyalty_tiers where org_id=_org and name='Silver'   limit 1;
  select id into t_gold   from loyalty_tiers where org_id=_org and name='Gold'     limit 1;
  select id into t_plat   from loyalty_tiers where org_id=_org and name='Platinum' limit 1;

  select id into c_olivia from customers where org_id=_org and name='Olivia Bennett' limit 1;
  select id into c_marcus from customers where org_id=_org and name='Marcus Chen'    limit 1;

  select id into v_ocean from vendors where org_id=_org and name='Ocean Direct'      limit 1;
  select id into v_green from vendors where org_id=_org and name='GreenField Farms'  limit 1;
  select id into v_prime from vendors where org_id=_org and name='Prime Cuts Co'     limit 1;

  select id into inv_salmon from inventory_items where org_id=_org and name='Salmon fillet'     limit 1;
  select id into inv_cod    from inventory_items where org_id=_org and name='Black cod'         limit 1;
  select id into inv_tom    from inventory_items where org_id=_org and name='Heirloom tomatoes' limit 1;
  select id into inv_rice   from inventory_items where org_id=_org and name='Arborio rice'      limit 1;

  -- 1. Loyalty: fill in status_points / tier_id / newsletter / birthday --------
  update customers set
    status_points     = points,
    newsletter_opt_in = (points >= 1000),
    birthday          = (current_date - (((20 + (random()*40)::int) * 365) || ' days')::interval)::date,
    tier_id           = case tier
                          when 'Bronze'   then t_bronze
                          when 'Silver'   then t_silver
                          when 'Gold'     then t_gold
                          when 'Platinum' then t_plat
                        end
  where org_id = _org;

  -- Loyalty point history (welcome + earned) so the CRM ledger has signal.
  insert into loyalty_transactions (org_id, customer_id, points_delta, reason, created_at)
    select _org, id, 100, 'Signup bonus', created_at from customers where org_id=_org;
  insert into loyalty_transactions (org_id, customer_id, points_delta, reason, created_at)
    select _org, id, greatest(points - 100, 0), 'Points earned on purchases', now()-interval '8 days'
    from customers where org_id=_org;

  -- One issued redemption (voucher) for the top customer.
  select id into rw_id from loyalty_rewards where org_id=_org order by sort_order limit 1;
  if c_olivia is not null and rw_id is not null then
    insert into loyalty_redemptions (org_id, customer_id, reward_id, reward_snapshot, points_spent, code, status)
    values (_org, c_olivia, rw_id, '{}'::jsonb, 500, 'DEMO-'||upper(substr(md5(random()::text),1,8)), 'issued');
  end if;

  -- 2. Reservations (Floor) — varied statuses across past/future --------------
  insert into reservations (org_id, table_id, customer_id, guest_name, phone, party_size, starts_at, status, source, note) values
    (_org, (select id from restaurant_tables where org_id=_org and seats>=4 order by random() limit 1), c_marcus, 'Marcus Chen','+49 170 1234567', 4, now()+interval '3 hours','booked','public','Window seat please'),
    (_org, (select id from restaurant_tables where org_id=_org order by random() limit 1), null, 'Hannah Weber','+49 171 2223344', 2, now()+interval '1 day' + interval '19 hours','booked','public',null),
    (_org, (select id from restaurant_tables where org_id=_org and seats>=6 order by random() limit 1), null, 'Birthday Party (Schmidt)','+49 152 9988776', 6, now()+interval '2 days' + interval '20 hours','booked','staff','Bringing a cake'),
    (_org, (select id from restaurant_tables where org_id=_org order by random() limit 1), c_olivia, 'Olivia Bennett','+49 160 5556677', 2, now()-interval '20 hours','completed','public',null),
    (_org, (select id from restaurant_tables where org_id=_org order by random() limit 1), null, 'No-show Table','+49 155 1112233', 3, now()-interval '1 day' - interval '2 hours','no_show','public',null),
    (_org, (select id from restaurant_tables where org_id=_org order by random() limit 1), null, 'Seated Now','+49 159 4445566', 2, now()-interval '20 minutes','seated','staff',null);

  -- 3. Delivery orders + deliveries (one per status) + delivery zones ----------
  for i in 1..4 loop
    update orgs set next_order_no = next_order_no + 1 where id=_org returning next_order_no - 1 into _no;
    insert into orders (org_id, order_number, order_type, items, subtotal, tax, tip, total, status, kitchen_status, source, guest_name, created_at)
    select _org, 'ORD-'||lpad(_no::text,4,'0'), 'delivery'::order_type,
           jsonb_agg(jsonb_build_object('recipe_id', r.id, 'name', r.name, 'qty', 1, 'price', r.price)),
           sum(r.price), round(sum(r.price)*0.085,2), 0, round(sum(r.price)*1.085,2),
           (case when i=4 then 'paid' else 'open' end)::order_status, 'preparing'::kitchen_status, 'storefront',
           'Delivery Customer '||i, now() - (i || ' hours')::interval
    from (select id, name, price from recipes where org_id=_org order by random() limit 2) r
    returning id into o_id;

    insert into deliveries (org_id, order_id, courier_employee_id, address, phone, status, eta, created_at)
    values (_org, o_id,
            case when i = 1 then null else emp_courier end,  -- pending = unassigned
            i||' Hauptstrasse, 1011'||i||' Berlin', '+49 30 1234'||i,
            (array['pending','assigned','picked_up','delivered'])[i]::delivery_status,
            (15*i)||' min', now() - (i || ' hours')::interval);
  end loop;

  insert into delivery_zones (org_id, postcode, min_order, delivery_fee, is_active) values
    (_org,'10115',20,2.5,true),(_org,'10117',20,2.5,true),
    (_org,'10119',25,3.0,true),(_org,'10243',30,3.5,true)
  on conflict (org_id, postcode) do nothing;

  -- 4. Timeclock — closed shifts yesterday + one open shift now ----------------
  insert into time_entries (org_id, employee_id, clock_in, clock_out, break_seconds)
    select _org, id,
           date_trunc('day', now()) - interval '1 day' + interval '10 hours',
           date_trunc('day', now()) - interval '1 day' + interval '18 hours',
           1800
    from employees where org_id=_org;
  if emp_server is not null then
    insert into time_entries (org_id, employee_id, clock_in) values (_org, emp_server, now()-interval '3 hours');
  end if;

  -- 5. Marketing campaigns -----------------------------------------------------
  insert into campaigns (org_id, name, channel, status, scheduled_at, stats) values
    (_org,'Weekend Brunch Launch','email','sent',      now()-interval '6 days',  '{"sent":820,"opened":410,"clicked":96}'::jsonb),
    (_org,'Loyalty Double Points','sms','scheduled',   now()+interval '2 days',  '{}'::jsonb),
    (_org,'New Spring Menu','email','draft',           null,                     '{}'::jsonb),
    (_org,'In-store Tasting Event','in_store','sent',  now()-interval '20 days', '{"reach":300}'::jsonb);

  -- 6. Supplier bill + line items + price intelligence -------------------------
  if v_ocean is not null then
    insert into supplier_bills (org_id, vendor_id, vendor_name, bill_date, total, status)
      values (_org, v_ocean, 'Ocean Direct', current_date-2, 1840, 'confirmed')
      returning id into bill_id;
    insert into supplier_bill_items (org_id, bill_id, inventory_item_id, raw_name, qty, unit, unit_price) values
      (_org, bill_id, inv_salmon, 'Salmon fillet', 30, 'kg', 33.5),
      (_org, bill_id, inv_cod,    'Black cod',      12, 'kg', 40.0);
  end if;

  -- Price history (trend + an alternative cheaper vendor) for the intel charts.
  if inv_salmon is not null then
    insert into supplier_item_prices (org_id, inventory_item_id, vendor_id, item_name, vendor_name, price, unit, source, effective_from) values
      (_org, inv_salmon, v_ocean, 'Salmon fillet','Ocean Direct',     34.0,'kg','invoice', now()-interval '40 days'),
      (_org, inv_salmon, v_ocean, 'Salmon fillet','Ocean Direct',     33.5,'kg','invoice', now()-interval '12 days'),
      (_org, inv_salmon, v_ocean, 'Salmon fillet','Ocean Direct',     35.2,'kg','invoice', now()-interval '2 days'),
      (_org, inv_salmon, v_prime, 'Salmon fillet','Prime Cuts Co',    31.9,'kg','manual',  now()-interval '5 days');
  end if;
  if inv_tom is not null then
    insert into supplier_item_prices (org_id, inventory_item_id, vendor_id, item_name, vendor_name, price, unit, source, effective_from) values
      (_org, inv_tom, v_green, 'Heirloom tomatoes','GreenField Farms', 7.5,'kg','invoice', now()-interval '30 days'),
      (_org, inv_tom, v_green, 'Heirloom tomatoes','GreenField Farms', 8.2,'kg','invoice', now()-interval '6 days');
  end if;

  -- 7. Notifications -----------------------------------------------------------
  insert into notifications (org_id, type, title, body, created_at) values
    (_org,'public_order','New online order','A delivery order just came in', now()-interval '1 hour'),
    (_org,'reservation','New reservation','Marcus Chen — 4 guests at 19:00', now()-interval '2 hours'),
    (_org,'inventory','Low stock alert','Black cod is below par level', now()-interval '5 hours');

  -- 8. Purchase-order line items for the 0001 demo POs -------------------------
  for rec in select id from purchase_orders where org_id=_org loop
    insert into purchase_order_items (org_id, po_id, inventory_item_id, name, qty, unit_cost) values
      (_org, rec.id, inv_salmon, 'Salmon fillet', 10, 33),
      (_org, rec.id, inv_rice,   'Arborio rice',  20, 4.2);
  end loop;

  -- 9. Inventory movements (sales / waste / restock) ---------------------------
  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, created_at)
    select _org, id, name, -2, 'sale', now()-interval '1 day' from inventory_items where org_id=_org limit 4;
  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, waste_reason, note, created_at)
    select _org, id, name, -1, 'waste', 'spoiled', 'Past expiry', now()-interval '2 days'
    from inventory_items where org_id=_org and category='Seafood' limit 2;
  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, created_at)
    select _org, id, name, 10, 'purchase', now()-interval '3 days' from inventory_items where org_id=_org limit 3;
end $$;

grant execute on function public.seed_demo_extras(uuid) to authenticated, service_role;
