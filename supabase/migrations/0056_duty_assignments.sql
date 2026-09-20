-- ============================================================================
-- 0056 · Duty assignments + starter daily checklists
--
-- 1. duty_assignments: who holds each duty (frontend / kitchen_lead /
--    commi_kitchen). A person is either an employee row (staff) or a login
--    (partner / manager), never both in one row. Anyone holding a duty gets
--    every task assigned to it — daily checklists and one-off tasks alike.
--    Readable by every member (so colleagues can see who covers what);
--    only owner/admin/manager can change it.
--
-- 2. seed_daily_tasks(org): loads the starter checklists (idempotent — skips
--    a title that already exists as a daily task) and is run once for
--    Kokoland below. Content mirrors src/data/daily-task-templates.ts.
--
-- Requires 0055 (staff_role / department enums, tasks.assigned_role etc.).
-- ============================================================================

create table if not exists public.duty_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  duty public.staff_role not null,
  employee_id uuid references public.employees(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint duty_assignments_one_person check ((employee_id is null) <> (user_id is null))
);

create unique index if not exists duty_assignments_employee_uq
  on public.duty_assignments (org_id, duty, employee_id) where employee_id is not null;
create unique index if not exists duty_assignments_user_uq
  on public.duty_assignments (org_id, duty, user_id) where user_id is not null;

alter table public.duty_assignments enable row level security;

drop policy if exists duty_assignments_member_select on public.duty_assignments;
create policy duty_assignments_member_select on public.duty_assignments for select
  using (is_org_member(org_id));
drop policy if exists duty_assignments_manager_insert on public.duty_assignments;
create policy duty_assignments_manager_insert on public.duty_assignments for insert
  with check (has_org_role(org_id,'owner','admin','manager'));
drop policy if exists duty_assignments_manager_delete on public.duty_assignments;
create policy duty_assignments_manager_delete on public.duty_assignments for delete
  using (has_org_role(org_id,'owner','admin','manager'));

-- ---- Daily Tasks module: register it and grant it by default ---------------
-- Same function as 0045 with 'dailytasks' added for manager and staff. Inserting
-- the module row fires on_module_added (0041), which grants it to every
-- existing member whose role default includes it.
create or replace function public.default_modules_for_role(_role org_role)
returns text[] language sql immutable as $$
  select case _role::text
    when 'owner' then array(select id from public.modules)
    when 'admin' then array(select id from public.modules)
    when 'partner' then array(select id from public.modules)
    when 'manager' then array['dashboard','myday','pos','kitchen','floor','recipes','inventory','procurement','delivery','sales','insights','menu','reports','staff','timeclock','tasks','crm','zreport','till','dailytasks']
    when 'staff' then array['myday','pos','preorders','channels','kitchen','floor','timeclock','tasks','dailytasks']
    when 'accountant' then array['dashboard','myday','finance','accounting','reports','zreport','till','insights']
    when 'viewer' then array['dashboard','sales','insights']
  end
$$;

insert into public.modules (id, name, grouping, sort)
values ('dailytasks', 'Daily Tasks', 'Operate', 13)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- Photos: a reference "how it should look" picture per task, an optional
-- must-attach-a-photo rule, and the photos people upload as proof. Files live
-- in the existing public org-assets bucket; only their URLs are stored here.
alter table public.tasks
  add column if not exists example_photo_url text,
  add column if not exists requires_photo boolean not null default false,
  add column if not exists proof_photos jsonb not null default '[]'::jsonb;

create or replace function public.seed_daily_tasks(_org uuid)
returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  insert into public.tasks
    (org_id, title, description, priority, position, assigned_role, is_daily, department, checklist, requires_photo)
  select _org, v.title, v.descr, v.prio::task_priority, 100 + v.ord,
         v.role::public.staff_role, true, v.dept::public.department,
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', u.s, 'done', false) order by u.o)
              from unnest(v.steps) with ordinality as u(s, o)),
           '[]'::jsonb),
         v.photo
    from (values
    (0, 'Front-of-house open check', 'Lights, music, card terminal and till float ready', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (1, 'Guest area setup', 'Wipe tables, set cutlery caddies, check takeaway packing stock (boxes, bags, lids)', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (2, 'Prepare drinks', 'Coconut Thunder, Pina Colada and lemonades with Naruneendi ready to serve', 'high', 'frontend', 'front_of_house', array['Coconut Thunder', 'Pina Colada', 'Lemonades with Naruneendi']::text[], false),
    (3, 'Prepare cocktails', 'All cocktail ingredients, garnishes and glasses ready', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (4, 'Pack main dishes', 'Take mains from the bain-marie and pack for takeaway', 'high', 'frontend', 'front_of_house', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (5, 'Rice and heating', 'Rice cooked and kept hot; heat dishes before serving', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (6, 'Check drink stock (5+ portions)', 'Always at least 5 portions of each drink ready', 'high', 'frontend', 'front_of_house', array['Coconut Thunder', 'Pina Colada', 'Lemonades with Naruneendi']::text[], false),
    (7, 'Check cutlery, plates & glasses', 'Enough cutlery, main plates and glasses at the front', 'high', 'frontend', 'front_of_house', array['Cutlery', 'Main plates', 'Glasses']::text[], false),
    (8, 'Check front inventory', 'Enough of the front-line staples before service', 'high', 'frontend', 'front_of_house', array['Porotta', 'Coconut milk', 'Oil', 'Ketchup']::text[], false),
    (9, 'Inventory in its proper place', 'Every inventory item stored in its labelled location, easy for anyone to find', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (10, 'Allergen & label check', 'Allergen info and labels match today''s dishes', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (11, 'Clean front desk & tables', 'Front desk, tables and under the tables', 'medium', 'frontend', 'front_of_house', '{}'::text[], true),
    (12, 'Clean floors', 'Sweep and mop the guest area', 'medium', 'frontend', 'front_of_house', '{}'::text[], true),
    (13, 'Clean guest toilets & urinals', 'Toilets, urinals, sinks and floor', 'high', 'frontend', 'front_of_house', '{}'::text[], true),
    (14, 'Check tissue & toilet paper', 'Tissue and toilet paper stocked in every restroom', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (15, 'Clean mirrors', 'Front area and restroom mirrors', 'low', 'frontend', 'front_of_house', '{}'::text[], false),
    (16, 'Close till', 'Count and close the till, complete the end-of-day cash out', 'high', 'frontend', 'front_of_house', '{}'::text[], false),
    (17, 'Lock-up check', 'Lights off, doors, windows and card terminal closed', 'medium', 'frontend', 'front_of_house', '{}'::text[], false),
    (18, 'Chiller & bain-marie temperature log', 'Record every chiller, freezer and the bain-marie; flag anything out of range', 'high', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (19, 'Cooked dish locations', 'Each cooked dish is in its assigned chiller; note which chiller holds which item', 'high', 'kitchen_lead', 'kitchen', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (20, 'Label cooked dishes (FIFO)', 'Date and label every cooked dish before it goes in the chiller', 'high', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (21, 'Recipe check', 'Every dish cooked to its recipe; recipes in DishData complete and current', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (22, 'Prep list for the day', 'Set prep quantities per dish from recent sales', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (23, 'Delivery check', 'Check incoming goods for quantity, damage and expiry before signing', 'medium', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (24, 'Waste log', 'Record what was thrown away and why', 'low', 'kitchen_lead', 'kitchen', '{}'::text[], false),
    (25, 'Clean kitchen floors', 'Sweep and mop all kitchen floors', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], true),
    (26, 'Wash dishes', 'All dishes washed, sink area clean', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (27, 'Check bain-marie stock (5+ portions)', 'At least 5 portions of each main dish in the bain-marie', 'high', 'commi_kitchen', 'kitchen', array['Beef curry', 'Chicken curry', 'Paneer butter masala', 'Veg stew']::text[], false),
    (28, 'Check curry plates', 'Enough curry plates ready for service', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (29, 'Hand-wash station check', 'Soap, paper towels and hot water at every sink', 'low', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (30, 'Bins and trash out', 'Empty all bins, take waste out, replace liners', 'medium', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (31, 'Equipment off', 'Grill, stove, fryer and extractor off; gas closed', 'high', 'commi_kitchen', 'kitchen', '{}'::text[], false),
    (32, 'Clean grill', 'Grill surface and grates; match the example photo', 'high', null::text, 'kitchen', array['Scrape grates', 'Degrease surface', 'Wipe outside']::text[], true),
    (33, 'Clean stove', 'Burners, hob and surrounding wall; match the example photo', 'high', null::text, 'kitchen', array['Remove and wash burner caps', 'Degrease hob', 'Wipe wall and knobs']::text[], true),
    (34, 'Clean work table between stations', 'Work table in between stations; match the example photo', 'medium', null::text, 'kitchen', array['Clear the table', 'Scrub and sanitise', 'Dry and reset']::text[], true),
    (35, 'Clean employee toilet', 'Toilet, sink, floor and supplies', 'medium', null::text, 'front_of_house', '{}'::text[], true)
    ) as v(ord, title, descr, prio, role, dept, steps, photo)
   where not exists (
     select 1 from public.tasks t where t.org_id = _org and t.is_daily and t.title = v.title
   );
  get diagnostics n = row_count;
  return n;
end $$;

-- Not granted to app users: it's run from the SQL editor.
revoke all on function public.seed_daily_tasks(uuid) from public, anon, authenticated;

-- Load the starter checklists into Kokoland.
select public.seed_daily_tasks(id) from public.orgs where name ilike 'kokoland%';
