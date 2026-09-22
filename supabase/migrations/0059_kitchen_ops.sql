-- ============================================================================
-- 0059 · Kitchen Ops: production standards, live kitchen counts, kitchen log,
--        ticket timing, and the Kitchen Ops module
--
-- kitchen_dishes: one row per production component (Porotta, Chicken Curry, ...):
--   how it is made/held/finished, batch + reorder rules, and the LIVE counts the
--   line updates (hot_portions in the bain-marie/hot box, fridge_portions chilled, or the
--   freezer for items bought frozen: porotta, uzhunnuvada, parippuvada, pathiri).
--   "terms" are lowercase fragments: an order line containing one counts a portion
--   of that component, so "Porotta with Beef Curry" uses Porotta AND Beef Curry.
--   Any member can update counts; only owner/admin/manager add or remove dishes.
-- kitchen_log: cooked / wasted / stockout events (waste %, "runs out often", etc).
-- orders.kitchen_*_at: stamped by a trigger when a ticket changes kitchen status,
--   which is what makes prep time and customer wait measurable.
--
-- Seeds Kokoland's 26 components (from the 26 Aug - 19 Sep 2026 sales export).
-- Idempotent. Supersedes the unused bain_marie_items table from the first 0057 draft.
-- ============================================================================

create table if not exists public.kitchen_dishes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  recipe_id uuid references public.recipes(id) on delete set null,
  dish text not null,
  terms text not null default '',
  method text not null default 'hot_hold'
    check (method in ('hot_hold','fridge_reheat','pan_finish','fresh','batch_portion','assembly')),
  bain_marie text not null default 'no' check (bain_marie in ('yes','limited','no')),
  open_pct numeric not null default 0.8 check (open_pct >= 0 and open_pct <= 1),
  portion text not null default '1 serving',
  portion_g integer,
  frozen boolean not null default false,
  station text not null default 'curry',
  container text not null default '',
  batch_portions integer not null default 3 check (batch_portions >= 0),
  min_portions integer not null default 1 check (min_portions >= 0),
  reorder_at integer not null default 2 check (reorder_at >= 0),
  prep_minutes integer not null default 30,
  finish_minutes integer not null default 2,
  target_wait_min integer not null default 5,
  hold_temp_c integer,
  max_hold_min integer,
  notes text not null default '',
  hot_portions integer not null default 0 check (hot_portions >= 0),
  fridge_portions integer not null default 0 check (fridge_portions >= 0),
  position integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (org_id, dish)
);

create table if not exists public.kitchen_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  dish text not null,
  kind text not null check (kind in ('cooked','wasted','stockout')),
  portions numeric not null default 0,
  value numeric not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists kitchen_log_org_time_idx on public.kitchen_log (org_id, created_at desc);

alter table public.orders
  add column if not exists kitchen_started_at timestamptz,
  add column if not exists kitchen_ready_at timestamptz,
  add column if not exists kitchen_served_at timestamptz;

create or replace function public.stamp_kitchen_times()
returns trigger language plpgsql as $$
begin
  if new.kitchen_status is distinct from old.kitchen_status then
    if new.kitchen_status::text in ('preparing','ready','served') and new.kitchen_started_at is null then
      new.kitchen_started_at := now();
    end if;
    if new.kitchen_status::text in ('ready','served') and new.kitchen_ready_at is null then
      new.kitchen_ready_at := now();
    end if;
    if new.kitchen_status::text = 'served' and new.kitchen_served_at is null then
      new.kitchen_served_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orders_stamp_kitchen_times on public.orders;
create trigger orders_stamp_kitchen_times before update on public.orders
  for each row execute function public.stamp_kitchen_times();

alter table public.kitchen_dishes enable row level security;
alter table public.kitchen_log enable row level security;

drop policy if exists kitchen_dishes_member_select on public.kitchen_dishes;
create policy kitchen_dishes_member_select on public.kitchen_dishes for select using (is_org_member(org_id));
drop policy if exists kitchen_dishes_member_update on public.kitchen_dishes;
create policy kitchen_dishes_member_update on public.kitchen_dishes for update using (is_org_member(org_id));
drop policy if exists kitchen_dishes_manager_insert on public.kitchen_dishes;
create policy kitchen_dishes_manager_insert on public.kitchen_dishes for insert
  with check (has_org_role(org_id,'owner','admin','manager'));
drop policy if exists kitchen_dishes_manager_delete on public.kitchen_dishes;
create policy kitchen_dishes_manager_delete on public.kitchen_dishes for delete
  using (has_org_role(org_id,'owner','admin','manager'));

drop policy if exists kitchen_log_member_select on public.kitchen_log;
create policy kitchen_log_member_select on public.kitchen_log for select using (is_org_member(org_id));
drop policy if exists kitchen_log_member_insert on public.kitchen_log;
create policy kitchen_log_member_insert on public.kitchen_log for insert with check (is_org_member(org_id));
drop policy if exists kitchen_log_manager_delete on public.kitchen_log;
create policy kitchen_log_manager_delete on public.kitchen_log for delete
  using (has_org_role(org_id,'owner','admin','manager'));

-- Kitchen Ops module: granted to staff and managers by default (owners/admins/partners get every module).
-- Same function as 0058 with 'kitchenops' added.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks','marketing','kitchenops']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks','kitchenops']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

insert into public.modules (id, name, grouping, sort)
values ('kitchenops', 'Kitchen Ops', 'Operate', 14)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- Kokoland's production plan. Links each component to the menu recipe of the same name where one exists.
insert into public.kitchen_dishes
  (org_id, recipe_id, position, dish, terms, method, bain_marie, open_pct, frozen, station, container,
   batch_portions, min_portions, reorder_at, prep_minutes, finish_minutes, target_wait_min,
   hold_temp_c, max_hold_min, notes)
select o.id,
       (select r.id from public.recipes r where r.org_id = o.id and lower(r.name) = lower(v.dish) limit 1),
       v.pos, v.dish, v.terms, v.method, v.bain, v.open_pct, v.frozen, v.station, v.container,
       v.batch, v.minp, v.reorder, v.prep, v.finish, v.wait, v.hold, v.maxhold, v.notes
from public.orgs o,
     (values
    (1, 'Porotta', 'porotta,parotta', 'hot_hold', 'no', 1, true, 'tawa', 'Covered hot tray', 8, 2, 4, 8, 1, 3, 65, 90, 'Bought frozen: cook from frozen in rolling mini-batches of 8 and count the freezer too. Confirm pieces per serving with the chef.'),
    (2, 'Chicken Curry', 'chicken curry,chicken mix', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 4, 1, 2, 45, 1, 3, 65, 180, 'Small live batch; chilled backup; rapid reheat before hot holding.'),
    (3, 'Puttu', 'puttu', 'batch_portion', 'no', 1, false, 'steam', 'Portion cups', 2, 1, 1, 15, 8, 9, 65, 20, 'Pre-portion flour and coconut; steam fresh to order.'),
    (4, 'Beef Roast', 'beef roast', 'pan_finish', 'no', 1, false, 'pan', 'Portion tray', 4, 1, 2, 75, 4, 8, 65, 30, 'Pre-cook and portion; finish and reduce in the pan for texture.'),
    (5, 'Chicken Biriyani', 'chicken biriyani,chicken biryani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN / insulated pot', 4, 1, 2, 75, 2, 4, 65, 120, 'Plan batches; never the whole day at once; protect rice texture.'),
    (6, 'Gobi Manchurian', 'gobi', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 3, 1, 1, 20, 6, 8, null, null, 'Pre-prep florets and sauce; fry/toss fresh.'),
    (7, 'Beef Curry', 'beef curry,beef mix', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 3, 1, 2, 90, 1, 3, 65, 180, 'Good bain-marie candidate; avoid holding the whole day''s batch.'),
    (8, 'Beef Fry / Dry Fry', 'beef fry,beef dry fry,dry fry', 'pan_finish', 'no', 1, false, 'pan', 'Portion tray', 4, 1, 2, 60, 4, 8, 65, 30, 'Do not bain-marie; finish dry in the pan.'),
    (9, 'Kadala Curry', 'kadala', 'hot_hold', 'yes', 0.7, false, 'curry', 'GN 1/3', 3, 1, 1, 60, 1, 3, 65, 180, 'Stable small-batch hot-hold candidate. Soak chickpeas the night before.'),
    (10, 'Paneer Butter Masala', 'paneer butter masala', 'hot_hold', 'yes', 0.65, false, 'curry', 'GN 1/3', 3, 1, 2, 35, 1, 3, 65, 120, 'Smaller live batch to protect paneer texture.'),
    (11, 'Veg Kurma', 'kurma,kuruma', 'hot_hold', 'yes', 0.65, false, 'curry', 'GN 1/3', 2, 1, 1, 35, 1, 3, 65, 120, 'Keep the batch small because demand is lower.'),
    (12, 'Pazhampori', 'pazhampori,pazham pori,banana fritters', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 4, 1, 2, 15, 5, 8, null, null, 'Prep fruit and batter; fry fresh.'),
    (13, 'Chicken Cutlet', 'cutlet', 'fresh', 'no', 1, false, 'fryer', 'Portion tray', 3, 1, 1, 30, 5, 8, null, null, 'Pre-made; fry or reheat to order. Count ready portions before the rush.'),
    (14, 'Chicken 65', 'chicken 65', 'fresh', 'no', 1, false, 'fryer', 'Portion tray', 3, 1, 1, 30, 6, 8, null, null, 'Marinate and portion ahead; keep ready-to-fry portions; never hold fried chicken.'),
    (15, 'Onion Pakoda', 'onion pakoda', 'fresh', 'no', 1, false, 'fryer', 'Prep tray', 3, 1, 1, 15, 6, 8, null, null, 'Prepare enough mix for the next rush; fry to order.'),
    (16, 'Paneer Biriyani', 'paneer biriyani,paneer biryani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN 1/2', 3, 1, 1, 60, 2, 4, 65, 120, 'Smaller batch than chicken biriyani.'),
    (17, 'Rice', 'rice', 'hot_hold', 'limited', 0.8, false, 'rice', 'Rice hot-hold container', 3, 1, 1, 30, 1, 2, 65, 180, 'Cook a fresh pot every couple of hours rather than one huge batch. Set limits in your HACCP plan.'),
    (18, 'Paneer Chilli', 'paneer chilli', 'fresh', 'no', 1, false, 'pan', 'Prep tray', 2, 1, 1, 20, 5, 8, null, null, 'Finish fresh for texture.'),
    (19, 'Salad', 'salad', 'assembly', 'no', 1, false, 'cold', 'Cold GN', 2, 1, 1, 10, 2, 3, null, null, 'Keep components cold and portioned.'),
    (20, 'Chicken 65 Biriyani', 'chicken 65 biriyani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN + tray', 2, 1, 1, 75, 6, 8, 65, 120, 'Keep the fried component separate until service.'),
    (21, 'Dessert', 'pudding,payasam', 'batch_portion', 'no', 1, false, 'cold', 'Cold container', 3, 1, 1, 30, 1, 2, null, null, 'Count portions before service.'),
    (22, 'Fried Chicken Biriyani', 'fried chicken biriyani', 'hot_hold', 'limited', 0.85, false, 'rice', 'GN + tray', 3, 1, 1, 75, 6, 8, 65, 120, 'Control the rice batch; finish the chicken component to order.'),
    (23, 'Uzhunnuvada', 'uzhunnuvada', 'fresh', 'no', 1, true, 'fryer', 'Freezer tray', 2, 1, 1, 0, 6, 8, null, null, 'Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked.'),
    (24, 'Parippuvada', 'parippuvada,paripuvada', 'fresh', 'no', 1, true, 'fryer', 'Freezer tray', 2, 1, 1, 0, 6, 8, null, null, 'Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked.'),
    (25, 'Pathiri', 'pathiri', 'fresh', 'no', 1, true, 'tawa', 'Freezer tray', 4, 1, 2, 0, 4, 6, null, null, 'Bought frozen: heat on the tawa to order.'),
    (26, 'Chicken Roll', 'chicken roll', 'assembly', 'no', 1, false, 'cold', 'Prep tray', 2, 1, 1, 20, 4, 6, null, null, 'Keep filling and wraps ready; finish to order.')
     ) as v(pos, dish, terms, method, bain, open_pct, frozen, station, container, batch, minp, reorder, prep, finish, wait, hold, maxhold, notes)
where o.name ilike 'kokoland%'
on conflict (org_id, dish) do nothing;
