-- ============================================================================
-- 0065 · The catering catalogue, readable by an anonymous visitor
--
-- The catering page is meant to list everything the kitchen can cook for an
-- event, not just what happens to be on today's menu — a dish hidden this week,
-- or sold out this evening, says nothing about a party three weeks out. For
-- Kokoland that is 98 dishes rather than 40.
--
-- The app asked for them and silently got 40 anyway, because anon reads of
-- `recipes` are policy-limited to active rows:
--     recipes_public_read ... for select to anon using (is_active = true)
--
-- That policy is not the thing to relax. It guards every anonymous read of the
-- table, so opening it to `using (true)` would publish every retired and
-- unreleased dish — and its price — to anyone querying the API, for the sake of
-- one page. Instead this is a narrow security-definer view of exactly the
-- catering catalogue, the same approach place_public_order and
-- place_catering_inquiry already take: the broad table policy stays shut and
-- one specific question gets a specific answer.
--
-- Tournament items are still excluded, by name and by event-menu membership —
-- they are priced for an event and sold only at it.
-- ============================================================================

create or replace function public.catering_menu(_slug text)
returns setof public.recipes
language sql stable security definer set search_path = public as $$
  select r.*
    from recipes r
    join orgs o on o.id = r.org_id
   where o.slug = _slug
     and r.name not ilike '%(Tournament)%'
     and not exists (
       select 1 from event_menu_items emi where emi.recipe_id = r.id
     )
   order by r.category, r.name;
$$;

grant execute on function public.catering_menu(text) to anon, authenticated;
