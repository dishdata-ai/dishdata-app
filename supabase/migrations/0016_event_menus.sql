-- ============================================================================
-- 0016 · Event / popup menus
-- A restaurant can save several named, curated item lists (e.g. "Food Truck
-- Popup", "Cricket Match Weekend") and have POS show only those items instead
-- of the full recipes catalog — for events/popups where the full menu isn't
-- available. Staff-facing only (created/edited in the web app; both web and
-- mobile POS can select one to filter by).
-- ============================================================================

create table if not exists public.event_menus (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

-- Which recipes belong to a given event menu.
create table if not exists public.event_menu_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_menu_id uuid not null references public.event_menus(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_menu_id, recipe_id)
);

create index if not exists event_menu_items_menu_idx on public.event_menu_items(event_menu_id);

-- updated_at + created_by + RLS, reusing the project's array-driven patterns
-- (see 0007_price_intel.sql for the same shape).
do $$
declare t text;
begin
  execute 'drop trigger if exists set_updated_at on public.event_menus';
  execute 'create trigger set_updated_at before update on public.event_menus for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists set_created_by on public.event_menus';
  execute 'create trigger set_created_by before insert on public.event_menus for each row execute function public.set_created_by()';

  foreach t in array array['event_menus','event_menu_items'] loop
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
