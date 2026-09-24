-- ============================================================================
-- 0069 · Let a dish be kept off the catering catalogue on its own
--
-- The catering page deliberately ignores is_active and sold_out_until: a dish
-- hidden this week, or sold out this evening, says nothing about a party three
-- weeks out, so 0065 listed everything the kitchen can cook. That is right for
-- most dishes and wrong for a few — things that simply don't travel, don't
-- scale to a tray, or aren't worth quoting for an event. Those need their own
-- switch rather than a reuse of the day-to-day menu one, because the two
-- answers are genuinely independent: a dish can be off today's menu and still
-- perfectly good for catering, and vice versa.
--
-- Beverages, Extras and single portions are the likely candidates, but that is
-- the kitchen's call to make per dish, so nothing is pre-set here.
-- ============================================================================

alter table public.recipes
  add column if not exists hide_from_catering boolean not null default false;

comment on column public.recipes.hide_from_catering is
  'Keeps the dish off the public catering catalogue. Independent of is_active '
  '(the day-to-day menu) and sold_out_until (tonight''s availability).';

-- The catalogue itself. Same shape as 0065 — tournament dishes stay out by
-- name and by event-menu membership — with the new switch honoured.
create or replace function public.catering_menu(_slug text)
returns setof public.recipes
language sql stable security definer set search_path = public as $$
  select r.*
    from recipes r
    join orgs o on o.id = r.org_id
   where o.slug = _slug
     and not r.hide_from_catering
     and r.name not ilike '%(Tournament)%'
     and not exists (
       select 1 from event_menu_items emi where emi.recipe_id = r.id
     )
   order by r.category, r.name;
$$;

grant execute on function public.catering_menu(text) to anon, authenticated;

notify pgrst, 'reload schema';
