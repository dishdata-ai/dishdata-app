-- ============================================================================
-- DishData - Permanent, paste-safe repair for mojibake from pasting UTF-8 seed
-- data into the Supabase SQL editor (emoji / euro / en-dash bytes decoded as
-- Mac Roman). This file is PURE ASCII (chr(codepoint) only), so pasting it can
-- never re-corrupt anything -- unlike setup.sql, which contains real emoji.
--
-- It does two things:
--   1. Defines repair_demo_encoding(_org) -- restores correct glyphs for one org.
--      The app calls this right after seed_demo_data(), so every newly seeded
--      org is clean even if that instance's seed function was pasted corrupted.
--   2. Backfills: runs the repair across all existing orgs immediately.
--
-- Idempotent and safe to re-run. Run ONLY this file -- it supersedes 0003.
-- ============================================================================

create or replace function public.repair_demo_encoding(_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Allow the app (authenticated owner/admin) to call this; allow the
  -- migration/backfill path (no auth context) to run unguarded.
  if auth.uid() is not null and not has_org_role(_org, 'owner', 'admin') then
    raise exception 'admin only';
  end if;

  -- Recipe emojis (match seeded demo dish names within this org).
  update recipes set emoji = chr(128031) where org_id = _org and name = 'Grilled Salmon';
  update recipes set emoji = chr(127834) where org_id = _org and name = 'Truffle Risotto';
  update recipes set emoji = chr(127828) where org_id = _org and name = 'Wagyu Burger';
  update recipes set emoji = chr(127813) where org_id = _org and name = 'Burrata Caprese';
  update recipes set emoji = chr(129425) where org_id = _org and name = 'Crispy Calamari';
  update recipes set emoji = chr(127851) where org_id = _org and name = 'Chocolate Lava Cake';
  update recipes set emoji = chr(127856) where org_id = _org and name = 'Basque Cheesecake';
  update recipes set emoji = chr(127865) where org_id = _org and name = 'Yuzu Spritz';
  update recipes set emoji = chr(9749)   where org_id = _org and name = 'Cold Brew Tonic';
  update recipes set emoji = chr(129472) where org_id = _org and name = 'Chef''s Tasting Board';
  update recipes set emoji = chr(128032) where org_id = _org and name = 'Miso Glazed Cod';
  update recipes set emoji = chr(129367) where org_id = _org and name = 'Caesar Salad';

  -- Recipe-ingredient placeholder dashes: any non-ASCII qty_display -> '-'.
  update recipe_ingredients set qty_display = '-'
    where org_id = _org and qty_display !~ '^[ -~]*$';

  -- Employee shift notes (ASCII hyphens + chr(183) middle dot).
  update employees set shift_note = 'Mon-Fri ' || chr(183) || ' 10:00-19:00' where org_id = _org and name = 'Maria Santos';
  update employees set shift_note = 'Tue-Sat ' || chr(183) || ' 12:00-21:00' where org_id = _org and name = 'James Okafor';
  update employees set shift_note = 'Mon-Fri ' || chr(183) || ' 11:00-20:00' where org_id = _org and name = 'Lena Fischer';
  update employees set shift_note = 'Wed-Sun ' || chr(183) || ' 16:00-24:00' where org_id = _org and name = 'Diego Ruiz';
  update employees set shift_note = 'Thu-Mon ' || chr(183) || ' 16:00-23:00' where org_id = _org and name = 'Aisha Khan';
  update employees set shift_note = 'Wed-Sun ' || chr(183) || ' 17:00-01:00' where org_id = _org and name = 'Tom Nguyen';

  -- Loyalty reward labels/descriptions (euro sign was the only multibyte char).
  update loyalty_rewards set label = chr(8364) || '5 off',
         description = 'Take ' || chr(8364) || '5 off your next order'
    where org_id = _org and reward_type = 'amount_discount';
end $$;

grant execute on function public.repair_demo_encoding(uuid) to authenticated;

-- One-time backfill across every existing org.
do $$ declare o uuid; begin
  for o in select id from public.orgs loop
    perform public.repair_demo_encoding(o);
  end loop;
end $$;
