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
-- Kokoland's first three calls are set below: the Porotta rolls, the Loaded
-- Fries and the Pork Biriyani. Everything else stays in the catalogue until
-- someone hides it from the recipe panel.
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

-- Kokoland's own picks. Matched by category where the whole category goes, by
-- name for the single dish, and scoped to the org so this stays a data change
-- for one restaurant rather than a default anybody else inherits.
update public.recipes r
   set hide_from_catering = true
  from public.orgs o
 where o.id = r.org_id
   and o.slug = 'kokoland-berlin'
   and (r.category in ('Rolls', 'Loaded Fries') or r.name = 'Pork Biriyani');

notify pgrst, 'reload schema';
