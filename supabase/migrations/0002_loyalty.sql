-- ============================================================================
-- DishData — Advanced Loyalty Engine (Smile.io / LoyaltyLion-grade)
-- Run AFTER 0001_init.sql. Paste this whole file into the Supabase SQL Editor.
-- Idempotent: re-running is always safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
do $$ begin create type loyalty_tier_basis as enum ('lifetime','rolling_12mo','spend'); exception when duplicate_object then null; end $$;
do $$ begin create type loyalty_action_type as enum ('purchase','signup','birthday','instagram_follow','newsletter','review','referral','visit','custom'); exception when duplicate_object then null; end $$;
do $$ begin create type loyalty_reward_type as enum ('free_item','amount_discount','percent_discount','free_delivery','custom'); exception when duplicate_object then null; end $$;
do $$ begin create type loyalty_redemption_status as enum ('issued','applied','expired','void'); exception when duplicate_object then null; end $$;
do $$ begin create type loyalty_verification as enum ('auto','honor','verified'); exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------
create table if not exists public.loyalty_programs (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  enabled boolean not null default true,
  points_name text not null default 'points',
  earn_rate numeric not null default 1,            -- points per currency unit on purchase
  redeem_rate numeric not null default 0.1,        -- currency value per point (for display/discounts)
  tier_basis loyalty_tier_basis not null default 'lifetime',
  rolling_window_days integer not null default 365,
  points_expiry_days integer,                      -- null = never expires
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  threshold integer not null default 0,            -- points or spend needed to reach (per program.tier_basis)
  sort_order integer not null default 0,
  color text,
  icon text,
  perks jsonb not null default '{}'::jsonb,         -- { earn_multiplier, free_delivery, birthday_bonus, custom[] }
  created_at timestamptz not null default now()
);
create index if not exists loyalty_tiers_org_idx on public.loyalty_tiers (org_id, threshold);

create table if not exists public.loyalty_earn_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  action_type loyalty_action_type not null,
  label text not null,
  description text,
  points integer not null default 0,               -- fixed award (purchase uses program.earn_rate instead)
  enabled boolean not null default true,
  verification loyalty_verification not null default 'auto',
  repeatable boolean not null default false,
  cooldown_days integer,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_earn_rules_org_idx on public.loyalty_earn_rules (org_id, action_type);

create table if not exists public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  reward_type loyalty_reward_type not null,
  label text not null,
  description text,
  cost_points integer not null default 0,
  value numeric not null default 0,                -- discount amount or percent
  free_recipe_id uuid references public.recipes(id) on delete set null,
  min_tier_id uuid references public.loyalty_tiers(id) on delete set null,
  enabled boolean not null default true,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_rewards_org_idx on public.loyalty_rewards (org_id, sort_order);

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  reward_id uuid references public.loyalty_rewards(id) on delete set null,
  reward_snapshot jsonb not null default '{}'::jsonb,
  points_spent integer not null default 0,
  code text not null unique,
  status loyalty_redemption_status not null default 'issued',
  expires_at timestamptz,
  applied_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_redemptions_org_idx on public.loyalty_redemptions (org_id, customer_id);

create table if not exists public.loyalty_action_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  action_type loyalty_action_type not null,
  period_key text not null default '',             -- '' = one-time, 'YYYY' = per-year (birthday), unique ts = repeatable
  status text not null default 'awarded',           -- awarded | pending
  meta jsonb not null default '{}'::jsonb,
  claimed_at timestamptz not null default now(),
  unique (org_id, customer_id, action_type, period_key)
);

-- Extend customers (idempotent column adds)
alter table public.customers add column if not exists birthday date;
alter table public.customers add column if not exists status_points integer not null default 0;
alter table public.customers add column if not exists tier_id uuid references public.loyalty_tiers(id) on delete set null;
alter table public.customers add column if not exists newsletter_opt_in boolean not null default false;
alter table public.customers add column if not exists instagram_handle text;

-- Extend loyalty ledger
alter table public.loyalty_transactions add column if not exists action_type loyalty_action_type;
alter table public.loyalty_transactions add column if not exists redemption_id uuid references public.loyalty_redemptions(id) on delete set null;
alter table public.loyalty_transactions add column if not exists expires_at timestamptz;

-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['loyalty_programs','loyalty_tiers','loyalty_earn_rules','loyalty_rewards',
    'loyalty_redemptions','loyalty_action_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('create policy %I_member_select on public.%I for select using (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_insert on public.%I', t, t);
    execute format('create policy %I_member_insert on public.%I for insert with check (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_member_update on public.%I', t, t);
    execute format('create policy %I_member_update on public.%I for update using (is_org_member(org_id))', t, t);
    execute format('drop policy if exists %I_manager_delete on public.%I', t, t);
    execute format('create policy %I_manager_delete on public.%I for delete using (has_org_role(org_id,''owner'',''admin'',''manager''))', t, t);
  end loop;
end $$;

-- Public (anon) storefront reads: enabled program/tiers/rules/rewards
drop policy if exists loyalty_programs_public_read on public.loyalty_programs;
create policy loyalty_programs_public_read on public.loyalty_programs for select to anon using (enabled = true);
drop policy if exists loyalty_tiers_public_read on public.loyalty_tiers;
create policy loyalty_tiers_public_read on public.loyalty_tiers for select to anon using (true);
drop policy if exists loyalty_earn_rules_public_read on public.loyalty_earn_rules;
create policy loyalty_earn_rules_public_read on public.loyalty_earn_rules for select to anon using (enabled = true);
drop policy if exists loyalty_rewards_public_read on public.loyalty_rewards;
create policy loyalty_rewards_public_read on public.loyalty_rewards for select to anon using (enabled = true);

-- ----------------------------------------------------------------------------
-- 4. MODULE REGISTRATION
-- ----------------------------------------------------------------------------
insert into public.modules (id, name, grouping, sort) values ('loyalty','Loyalty','Grow',12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping, sort = excluded.sort;

create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','loyalty','zreport']
    when 'staff' then array['dashboard','myday','pos','kitchen','floor','timeclock','tasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

-- Backfill loyalty access for existing owners/admins/managers
insert into public.member_module_access (org_id, user_id, module_id, can_access)
select om.org_id, om.user_id, 'loyalty', true from public.org_members om
where om.role in ('owner','admin','manager')
on conflict (org_id, user_id, module_id) do nothing;

-- ----------------------------------------------------------------------------
-- 5. ENGINE FUNCTIONS
-- ----------------------------------------------------------------------------

-- Recompute a customer's tier from the program's configured basis.
create or replace function public.loyalty_recompute_tier(_org uuid, _customer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _basis loyalty_tier_basis; _window int; _metric numeric := 0; _tier record;
begin
  select tier_basis, rolling_window_days into _basis, _window from loyalty_programs where org_id = _org;
  if not found then return; end if;

  if _basis = 'spend' then
    select coalesce(total_spend,0) into _metric from customers where id = _customer and org_id = _org;
  elsif _basis = 'rolling_12mo' then
    select coalesce(sum(points_delta),0) into _metric from loyalty_transactions
      where org_id = _org and customer_id = _customer and points_delta > 0
        and created_at >= now() - (coalesce(_window,365) || ' days')::interval;
  else -- lifetime
    select coalesce(status_points,0) into _metric from customers where id = _customer and org_id = _org;
  end if;

  select * into _tier from loyalty_tiers where org_id = _org and threshold <= coalesce(_metric,0)
    order by threshold desc, sort_order desc limit 1;
  if found then
    update customers set tier_id = _tier.id, tier = _tier.name where id = _customer and org_id = _org;
  end if;
end $$;

-- Award points for an earn action. Idempotent for one-time/periodic actions.
create or replace function public.loyalty_award(_org uuid, _customer uuid, _action loyalty_action_type, _meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _rule record; _pts int; _period text; _bonus int := 0;
begin
  select * into _rule from loyalty_earn_rules where org_id = _org and action_type = _action and enabled = true limit 1;
  if not found then return jsonb_build_object('awarded',0,'status','no_rule'); end if;

  _period := case
    when _action = 'birthday' then to_char(now(),'YYYY')
    when _rule.repeatable then to_char(clock_timestamp(),'YYYYMMDDHH24MISSUS')
    else '' end;

  if not _rule.repeatable then
    if exists (select 1 from loyalty_action_claims
               where org_id=_org and customer_id=_customer and action_type=_action and period_key=_period) then
      return jsonb_build_object('awarded',0,'status','already_claimed');
    end if;
  elsif _rule.cooldown_days is not null then
    if exists (select 1 from loyalty_action_claims
               where org_id=_org and customer_id=_customer and action_type=_action
                 and claimed_at > now() - (_rule.cooldown_days || ' days')::interval) then
      return jsonb_build_object('awarded',0,'status','cooldown');
    end if;
  end if;

  -- Verified rules park a pending claim; points awarded later via loyalty_confirm_verification.
  if _rule.verification = 'verified' then
    insert into loyalty_action_claims (org_id, customer_id, action_type, period_key, status, meta)
      values (_org,_customer,_action,_period,'pending',_meta);
    return jsonb_build_object('awarded',0,'status','pending_verification');
  end if;

  _pts := coalesce(_rule.points,0);
  if _action = 'birthday' then
    select coalesce((t.perks->>'birthday_bonus')::int,0) into _bonus
      from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _customer;
    _pts := _pts + coalesce(_bonus,0);
  end if;

  insert into loyalty_action_claims (org_id, customer_id, action_type, period_key, status)
    values (_org,_customer,_action,_period,'awarded');
  insert into loyalty_transactions (org_id, customer_id, points_delta, reason, action_type)
    values (_org,_customer,_pts, coalesce(_rule.label,_action::text), _action);
  update customers set points = points + _pts, status_points = status_points + _pts
    where id = _customer and org_id = _org;
  perform loyalty_recompute_tier(_org,_customer);

  return jsonb_build_object('awarded',_pts,'status','ok');
end $$;

-- Confirm a parked 'verified' claim (admin/webhook hook): awards its rule's points.
create or replace function public.loyalty_confirm_verification(_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _c record; _rule record; _pts int;
begin
  select * into _c from loyalty_action_claims where id = _claim_id and status = 'pending';
  if not found then return jsonb_build_object('awarded',0,'status','not_pending'); end if;
  if not is_org_member(_c.org_id) then raise exception 'not a member of this organization'; end if;
  select * into _rule from loyalty_earn_rules where org_id = _c.org_id and action_type = _c.action_type and enabled = true limit 1;
  if not found then return jsonb_build_object('awarded',0,'status','no_rule'); end if;
  _pts := coalesce(_rule.points,0);
  update loyalty_action_claims set status = 'awarded' where id = _claim_id;
  insert into loyalty_transactions (org_id, customer_id, points_delta, reason, action_type)
    values (_c.org_id,_c.customer_id,_pts, coalesce(_rule.label,_c.action_type::text), _c.action_type);
  update customers set points = points + _pts, status_points = status_points + _pts
    where id = _c.customer_id and org_id = _c.org_id;
  perform loyalty_recompute_tier(_c.org_id,_c.customer_id);
  return jsonb_build_object('awarded',_pts,'status','ok');
end $$;

-- Redeem a reward for points → issue a voucher code. Does NOT reduce status_points (tier preserved).
create or replace function public.loyalty_redeem(_org uuid, _customer uuid, _reward uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _r record; _bal int; _code text; _mtier int; _ctier int;
begin
  select * into _r from loyalty_rewards where id = _reward and org_id = _org and enabled = true;
  if not found then raise exception 'reward unavailable'; end if;
  select coalesce(points,0) into _bal from customers where id = _customer and org_id = _org;
  if _bal < _r.cost_points then raise exception 'not enough points'; end if;

  if _r.min_tier_id is not null then
    select sort_order into _mtier from loyalty_tiers where id = _r.min_tier_id;
    select coalesce(t.sort_order,-1) into _ctier from customers c left join loyalty_tiers t on t.id = c.tier_id where c.id = _customer;
    if coalesce(_ctier,-1) < coalesce(_mtier,0) then raise exception 'tier too low for this reward'; end if;
  end if;

  _code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  update customers set points = points - _r.cost_points where id = _customer and org_id = _org;
  insert into loyalty_redemptions (org_id, customer_id, reward_id, reward_snapshot, points_spent, code, status, expires_at)
    values (_org,_customer,_r.id, to_jsonb(_r), _r.cost_points, _code, 'issued', now() + interval '30 days');
  insert into loyalty_transactions (org_id, customer_id, points_delta, reason)
    values (_org,_customer,-_r.cost_points,'Redeemed: ' || _r.label);

  return jsonb_build_object('code',_code,'reward',_r.label,'reward_type',_r.reward_type,'value',_r.value,'cost_points',_r.cost_points);
end $$;

-- Validate + value a voucher code against an order subtotal. Returns discount + free_recipe.
create or replace function public.loyalty_voucher_value(_org uuid, _code text, _subtotal numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _red record; _disc numeric := 0; _free uuid;
begin
  select * into _red from loyalty_redemptions where org_id = _org and code = upper(_code) and status = 'issued';
  if not found then return jsonb_build_object('valid',false,'reason','invalid or used'); end if;
  if _red.expires_at is not null and _red.expires_at < now() then
    update loyalty_redemptions set status = 'expired' where id = _red.id;
    return jsonb_build_object('valid',false,'reason','expired');
  end if;
  if (_red.reward_snapshot->>'reward_type') = 'amount_discount' then
    _disc := least(coalesce((_red.reward_snapshot->>'value')::numeric,0), _subtotal);
  elsif (_red.reward_snapshot->>'reward_type') = 'percent_discount' then
    _disc := round(_subtotal * coalesce((_red.reward_snapshot->>'value')::numeric,0) / 100, 2);
  elsif (_red.reward_snapshot->>'reward_type') = 'free_item' then
    _free := (_red.reward_snapshot->>'free_recipe_id')::uuid;
  end if;
  return jsonb_build_object('valid',true,'redemption_id',_red.id,'reward_type',_red.reward_snapshot->>'reward_type',
    'discount',_disc,'free_recipe_id',_free);
end $$;

-- ----------------------------------------------------------------------------
-- 6. DEFAULT PROGRAM SEED (a working, customizable starter for every org)
-- ----------------------------------------------------------------------------
create or replace function public.seed_default_loyalty(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _bronze uuid; _silver uuid; _gold uuid; _plat uuid;
begin
  insert into loyalty_programs (org_id) values (_org) on conflict (org_id) do nothing;
  if exists (select 1 from loyalty_tiers where org_id = _org) then return; end if;

  insert into loyalty_tiers (org_id,name,threshold,sort_order,color,perks) values
    (_org,'Bronze',0,0,'#cd7f32', jsonb_build_object('earn_multiplier',1,'birthday_bonus',50)) returning id into _bronze;
  insert into loyalty_tiers (org_id,name,threshold,sort_order,color,perks) values
    (_org,'Silver',500,1,'#c0c0c0', jsonb_build_object('earn_multiplier',1.25,'birthday_bonus',100)) returning id into _silver;
  insert into loyalty_tiers (org_id,name,threshold,sort_order,color,perks) values
    (_org,'Gold',2000,2,'#ffd700', jsonb_build_object('earn_multiplier',1.5,'birthday_bonus',200,'free_delivery',true)) returning id into _gold;
  insert into loyalty_tiers (org_id,name,threshold,sort_order,color,perks) values
    (_org,'Platinum',5000,3,'#e5e4e2', jsonb_build_object('earn_multiplier',2,'birthday_bonus',500,'free_delivery',true)) returning id into _plat;

  insert into loyalty_earn_rules (org_id,action_type,label,description,points,verification,repeatable) values
    (_org,'purchase','Make a purchase','Earn points on every order',0,'auto',true),
    (_org,'signup','Create an account','Welcome bonus for joining',100,'auto',false),
    (_org,'birthday','Birthday treat','Bonus points every birthday',200,'auto',false),
    (_org,'newsletter','Subscribe to the newsletter','One-time bonus for opting in',75,'honor',false),
    (_org,'instagram_follow','Follow on Instagram','One-time bonus for following',50,'honor',false),
    (_org,'review','Leave a review','Thank-you points for feedback',40,'honor',true);

  insert into loyalty_rewards (org_id,reward_type,label,description,cost_points,value,sort_order) values
    (_org,'amount_discount',chr(8364)||'5 off','Take '||chr(8364)||'5 off your next order',500,5,0),
    (_org,'percent_discount','10% off','10% off your whole order',800,10,1),
    (_org,'free_delivery','Free delivery','We cover delivery on your next order',300,0,2);
end $$;

-- Give existing orgs a default program too.
do $$ declare o uuid; begin
  for o in select id from public.orgs loop perform public.seed_default_loyalty(o); end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 7. BOOTSTRAP: create_organization now seeds a loyalty program
-- ----------------------------------------------------------------------------
create or replace function public.create_organization(_name text, _currency text default 'USD', _tax_rate numeric default 8.5)
returns uuid language plpgsql security definer set search_path = public as $$
declare _org uuid; _slug text; _n int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  _slug := regexp_replace(lower(trim(_name)), '[^a-z0-9]+', '-', 'g');
  _slug := trim(both '-' from _slug);
  if _slug = '' then _slug := 'restaurant'; end if;
  while exists (select 1 from orgs where slug = _slug || case when _n > 0 then '-' || _n else '' end) loop
    _n := _n + 1;
  end loop;
  if _n > 0 then _slug := _slug || '-' || _n; end if;

  insert into orgs (name, slug, currency, tax_rate) values (_name, _slug, _currency, _tax_rate) returning id into _org;
  insert into org_members (org_id, user_id, role) values (_org, auth.uid(), 'owner');
  update profiles set active_org_id = _org where id = auth.uid();
  perform seed_default_loyalty(_org);
  return _org;
end $$;

-- ----------------------------------------------------------------------------
-- 8. CHECKOUT: configurable earning + tier recompute + optional voucher
-- Drop the old 9-arg signature so the new 10-arg version isn't a separate overload.
-- ----------------------------------------------------------------------------
drop function if exists public.checkout_order(uuid,jsonb,order_type,uuid,uuid,text,numeric,jsonb,text);

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

  _tax := round(greatest(_subtotal - _discount, 0) * _rate / 100, 2);
  _total := round(greatest(_subtotal - _discount, 0) + _tax + coalesce(_tip, 0), 2);

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
-- 9. PUBLIC (anon) STOREFRONT LOYALTY RPCs
-- ----------------------------------------------------------------------------

-- Summary for a storefront visitor by email (no account required to view).
create or replace function public.loyalty_public_summary(_slug text, _email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _prog record; _cust record; _next record; _result jsonb;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  select * into _prog from loyalty_programs where org_id = _org;
  if not found or not _prog.enabled then return jsonb_build_object('enabled',false); end if;

  -- Always run the select so _cust is assigned (NULL-filled when no match);
  -- referencing fields of a never-assigned record raises "record is not assigned yet".
  select * into _cust from customers
    where org_id = _org and _email is not null and lower(email) = lower(_email) limit 1;

  select * into _next from loyalty_tiers where org_id = _org and threshold > coalesce(_cust.status_points,0)
    order by threshold asc limit 1;

  _result := jsonb_build_object(
    'enabled', true,
    'points_name', _prog.points_name,
    'tier_basis', _prog.tier_basis,
    'customer', case when _cust.id is null then null else jsonb_build_object(
        'id',_cust.id,'name',_cust.name,'points',_cust.points,'status_points',_cust.status_points,
        'tier',_cust.tier,'newsletter_opt_in',_cust.newsletter_opt_in) end,
    'next_tier', case when _next.id is null then null else jsonb_build_object('name',_next.name,'threshold',_next.threshold) end,
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object('name',name,'threshold',threshold,'color',color,'perks',perks) order by sort_order),'[]') from loyalty_tiers where org_id=_org),
    'earn_rules', (select coalesce(jsonb_agg(jsonb_build_object('action_type',action_type,'label',label,'description',description,'points',points,'verification',verification) order by created_at) filter (where enabled),'[]') from loyalty_earn_rules where org_id=_org),
    'rewards', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'reward_type',reward_type,'label',label,'description',description,'cost_points',cost_points,'value',value) order by sort_order) filter (where enabled),'[]') from loyalty_rewards where org_id=_org)
  );
  return _result;
end $$;

-- Find-or-create a customer by email, then honor-claim an earn action.
create or replace function public.loyalty_public_claim(_slug text, _email text, _name text, _action loyalty_action_type)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _cust uuid; _res jsonb;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if _email is null or length(trim(_email)) = 0 then raise exception 'email required'; end if;

  select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
  if _cust is null then
    insert into customers (org_id, name, email) values (_org, coalesce(nullif(trim(_name),''),'Guest'), lower(_email)) returning id into _cust;
    perform loyalty_recompute_tier(_org, _cust);
  end if;

  if _action = 'newsletter' then
    update customers set newsletter_opt_in = true where id = _cust;
  end if;

  _res := loyalty_award(_org, _cust, _action, '{}'::jsonb);
  return _res;
end $$;

-- Redeem a reward for a storefront customer by email.
create or replace function public.loyalty_public_redeem(_slug text, _email text, _reward uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _cust uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
  if _cust is null then raise exception 'no loyalty account for this email'; end if;
  return loyalty_redeem(_org, _cust, _reward);
end $$;

-- ----------------------------------------------------------------------------
-- 9b. PUBLIC ORDER with loyalty (voucher + earn) — replaces 0001's 5-arg version
-- ----------------------------------------------------------------------------
drop function if exists public.place_public_order(text,jsonb,text,text,text);
create or replace function public.place_public_order(
  _slug text, _items jsonb, _guest_name text default 'Guest',
  _table_name text default null, _notes text default null,
  _email text default null, _code text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _org uuid; _rate numeric; _subtotal numeric := 0; _tax numeric; _total numeric; _discount numeric := 0;
  _no int; _order_number text; _order_id uuid; _full_items jsonb := '[]'::jsonb;
  _cust uuid; _voucher jsonb; _prog record; _mult numeric := 1; _earn int := 0;
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

  _tax := round(greatest(_subtotal - _discount, 0) * _rate / 100, 2);
  _total := round(greatest(_subtotal - _discount, 0) + _tax, 2);

  if _email is not null and length(trim(_email)) > 0 then
    select id into _cust from customers where org_id = _org and lower(email) = lower(_email) limit 1;
    if _cust is null then
      insert into customers (org_id, name, email) values (_org, coalesce(nullif(trim(_guest_name),''),'Guest'), lower(_email)) returning id into _cust;
    end if;
  end if;

  update orgs set next_order_no = next_order_no + 1 where id = _org returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (org_id, order_number, order_type, guest_name, customer_id, items, subtotal, tax, total, status, kitchen_status, kitchen_notes, source)
  values (_org, _order_number, 'dine_in', _guest_name, _cust, _full_items, _subtotal, _tax, _total, 'open', 'new',
          coalesce('Table: ' || _table_name || '. ', '') || coalesce(_notes, ''), 'storefront')
  returning id into _order_id;

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

  return jsonb_build_object('order_number', _order_number, 'total', _total, 'discount', _discount);
end $$;

-- ----------------------------------------------------------------------------
-- 10. GRANTS
-- ----------------------------------------------------------------------------
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant execute on function public.loyalty_public_summary(text,text) to anon;
grant execute on function public.loyalty_public_claim(text,text,text,loyalty_action_type) to anon;
grant execute on function public.loyalty_public_redeem(text,text,uuid) to anon;
grant execute on function public.place_public_order(text,jsonb,text,text,text,text,text) to anon;
