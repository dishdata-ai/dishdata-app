-- ============================================================================
-- Kokoland Berlin — real loyalty program content
--
-- Replaces the generic Bronze/Silver/Gold/Platinum starter that
-- seed_default_loyalty() (0002_loyalty.sql) gives every new org with
-- Kokoland-specific tiers, ways to earn, and rewards.
--
-- THIS IS A DRAFT to get the program off the generic starter — rename tiers,
-- retune point thresholds, and edit rewards any time from the Loyalty admin
-- page (/loyalty). Idempotent: re-running always resets Kokoland's program
-- to this draft. Safe against existing redemptions/customers — deleting a
-- tier or reward only clears the foreign key (ON DELETE SET NULL), it never
-- touches redemption or customer rows, and loyalty_recompute_tier() puts
-- every customer back on the right tier the next time they earn or order.
-- ============================================================================

do $$
declare
  _org uuid;
  _t_boss uuid;
begin
  select id into _org from public.orgs where slug = 'kokoland-berlin';
  if _org is null then
    raise notice 'kokoland-berlin org not found — skipping';
    return;
  end if;

  -- Make sure a program row exists, then brand it.
  insert into public.loyalty_programs (org_id) values (_org) on conflict (org_id) do nothing;
  update public.loyalty_programs
    set points_name = 'Koko Points', earn_rate = 1, redeem_rate = 0.1
    where org_id = _org;

  -- Clear the generic starter tiers/rules/rewards for Kokoland only.
  delete from public.loyalty_rewards where org_id = _org;
  delete from public.loyalty_earn_rules where org_id = _org;
  delete from public.loyalty_tiers where org_id = _org;

  -- Tiers — lifetime points ≈ € spent at the 1pt/€1 earn rate above.
  insert into public.loyalty_tiers (org_id, name, threshold, sort_order, color, perks) values
    (_org, 'Newcomer',        0,    0, '#cd7f32', jsonb_build_object('earn_multiplier',1,   'birthday_bonus',50));
  insert into public.loyalty_tiers (org_id, name, threshold, sort_order, color, perks) values
    (_org, 'Porotta Regular', 300,  1, '#c0c0c0', jsonb_build_object('earn_multiplier',1.1, 'birthday_bonus',75));
  insert into public.loyalty_tiers (org_id, name, threshold, sort_order, color, perks) values
    (_org, 'Biriyani Boss',   800,  2, '#ffd700', jsonb_build_object('earn_multiplier',1.25,'birthday_bonus',150,'free_delivery',true))
    returning id into _t_boss;
  insert into public.loyalty_tiers (org_id, name, threshold, sort_order, color, perks) values
    (_org, 'Kokoland Family', 2000, 3, '#e5e4e2', jsonb_build_object('earn_multiplier',1.5, 'birthday_bonus',300,'free_delivery',true));

  -- Ways to earn.
  insert into public.loyalty_earn_rules (org_id, action_type, label, description, points, verification, repeatable) values
    (_org, 'purchase',         'Order from Kokoland',          'Earn Koko Points on every order',               0,   'auto',  true),
    (_org, 'signup',           'Join Kokoland Rewards',        'Welcome bonus for creating an account',         100, 'auto',  false),
    (_org, 'birthday',         'Your Kokoland birthday treat', 'Bonus points every birthday',                   150, 'auto',  false),
    (_org, 'newsletter',       'Get Kokoland offers by email', 'One-time bonus for opting in',                  75,  'honor', false),
    (_org, 'instagram_follow', 'Follow @kokoland.berlin',      'One-time bonus for following on Instagram',     60,  'honor', false),
    (_org, 'referral',         'Bring a friend to Kokoland',   'Bonus points when a friend orders and mentions you', 150, 'honor', true);

  -- Rewards — priced as amount/percent discounts so redemption actually
  -- applies at checkout today (loyalty_voucher_value only discounts
  -- amount_discount, percent_discount and free_delivery; free_item has no
  -- checkout-side effect yet, so it's left out of this draft on purpose).
  insert into public.loyalty_rewards (org_id, reward_type, label, description, cost_points, value, sort_order) values
    (_org, 'amount_discount', 'Free Samosa',           'A samosa on us — '||chr(8364)||'7 off your order',       350, 7,   0),
    (_org, 'amount_discount', 'Free Coconut Pudding',  'Dessert on us — '||chr(8364)||'4.50 off your order',     250, 4.5, 1),
    (_org, 'amount_discount', chr(8364)||'5 off',      'Take '||chr(8364)||'5 off your next order',              450, 5,   2),
    (_org, 'free_delivery',   'Free delivery',         'We cover delivery on your next order',                   300, 0,   3);
  insert into public.loyalty_rewards (org_id, reward_type, label, description, cost_points, value, min_tier_id, sort_order) values
    (_org, 'percent_discount', '10% off your order',   'Biriyani Boss and up: 10% off your whole order',         800, 10, _t_boss, 4);
end $$;

-- Verify.
select t.sort_order, t.name, t.threshold from public.loyalty_tiers t
  join public.orgs o on o.id = t.org_id where o.slug = 'kokoland-berlin' order by t.sort_order;
select r.sort_order, r.label, r.reward_type, r.cost_points, r.value from public.loyalty_rewards r
  join public.orgs o on o.id = r.org_id where o.slug = 'kokoland-berlin' order by r.sort_order;
