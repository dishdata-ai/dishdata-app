-- ============================================================================
-- 0020 · Event menus: optional public (website) visibility
-- An event menu is staff-facing by default (POS only). Setting
-- `show_on_website` makes it drive the customer-facing storefront too: while an
-- active event menu is marked public, the website shows exactly that menu's
-- dishes instead of the full catalog — e.g. during a popup or tournament.
--
-- The storefront reads as `anon`, so this adds public-read policies mirroring
-- `recipes_public_read` (0001). Only ACTIVE + PUBLIC menus are exposed; POS-only
-- event menus stay invisible to anon.
-- ============================================================================

alter table public.event_menus
  add column if not exists show_on_website boolean not null default false;

-- Anon may read only active, explicitly-public event menus.
drop policy if exists event_menus_public_read on public.event_menus;
create policy event_menus_public_read on public.event_menus
  for select to anon
  using (is_active = true and show_on_website = true);

-- ...and the items belonging to those menus.
drop policy if exists event_menu_items_public_read on public.event_menu_items;
create policy event_menu_items_public_read on public.event_menu_items
  for select to anon
  using (
    exists (
      select 1 from public.event_menus em
      where em.id = event_menu_items.event_menu_id
        and em.is_active = true
        and em.show_on_website = true
    )
  );
