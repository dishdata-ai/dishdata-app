-- ============================================================================
-- DishData - Repair mojibake from pasting UTF-8 seed data into the SQL editor.
-- Root cause: emoji / euro / en-dash bytes were decoded as Mac Roman on paste,
-- so the stored values (and the seed functions' string literals) are corrupted.
-- This script uses chr(codepoint) ONLY -- the source is pure ASCII, so pasting
-- it cannot re-corrupt anything. Idempotent; safe to re-run (e.g. after seeding
-- a new "sample data" org).
-- ============================================================================

-- ---- Recipe emojis (match by name across all orgs) -------------------------
update public.recipes set emoji = chr(128031) where name = 'Grilled Salmon';
update public.recipes set emoji = chr(127834) where name = 'Truffle Risotto';
update public.recipes set emoji = chr(127828) where name = 'Wagyu Burger';
update public.recipes set emoji = chr(127813) where name = 'Burrata Caprese';
update public.recipes set emoji = chr(129425) where name = 'Crispy Calamari';
update public.recipes set emoji = chr(127851) where name = 'Chocolate Lava Cake';
update public.recipes set emoji = chr(127856) where name = 'Basque Cheesecake';
update public.recipes set emoji = chr(127865) where name = 'Yuzu Spritz';
update public.recipes set emoji = chr(9749)   where name = 'Cold Brew Tonic';
update public.recipes set emoji = chr(129472) where name = 'Chef''s Tasting Board';
update public.recipes set emoji = chr(128032) where name = 'Miso Glazed Cod';
update public.recipes set emoji = chr(129367) where name = 'Caesar Salad';

-- ---- Employee shift notes (ASCII hyphens + chr(183) middle dot) -------------
update public.employees set shift_note = 'Mon-Fri ' || chr(183) || ' 10:00-19:00' where name = 'Maria Santos';
update public.employees set shift_note = 'Tue-Sat ' || chr(183) || ' 12:00-21:00' where name = 'James Okafor';
update public.employees set shift_note = 'Mon-Fri ' || chr(183) || ' 11:00-20:00' where name = 'Lena Fischer';
update public.employees set shift_note = 'Wed-Sun ' || chr(183) || ' 16:00-24:00' where name = 'Diego Ruiz';
update public.employees set shift_note = 'Thu-Mon ' || chr(183) || ' 16:00-23:00' where name = 'Aisha Khan';
update public.employees set shift_note = 'Wed-Sun ' || chr(183) || ' 17:00-01:00' where name = 'Tom Nguyen';

-- ---- Recipe-ingredient placeholder dashes: any non-ASCII qty_display -> '-' -
update public.recipe_ingredients set qty_display = '-' where qty_display !~ '^[ -~]*$';

-- ---- Loyalty reward labels/descriptions (euro sign was the only multibyte) --
update public.loyalty_rewards set label = chr(8364) || '5 off',
       description = 'Take ' || chr(8364) || '5 off your next order' where reward_type = 'amount_discount';
update public.loyalty_rewards set label = '10% off',
       description = '10% off your whole order' where reward_type = 'percent_discount';
update public.loyalty_rewards set label = 'Free delivery',
       description = 'We cover delivery on your next order' where reward_type = 'free_delivery';

-- ---- Make seed_default_loyalty paste-safe so NEW orgs aren't corrupted ------
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
