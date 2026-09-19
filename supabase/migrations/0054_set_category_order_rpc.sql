-- ============================================================================
-- 0054 · Let a manager/partner save the menu category order
--
-- CategoryOrderModal (Recipes page) is meant for a manager to fix, and any
-- org member with Recipes access can open it and drag categories around —
-- but saving goes through updateOrg(), which updates the whole `orgs` row,
-- and orgs_admin_update only allows owner/admin. A manager or partner
-- (Josna, running the restaurant day-to-day) hit a silent RLS failure
-- trying to save a reorder that the feature itself was built for them to do.
--
-- Rather than widening orgs_admin_update itself — that row also carries
-- business info and payment/TSE credentials that should stay owner/admin
-- only — this is a narrowly-scoped RPC that can only ever touch
-- settings.categoryOrder, open to manager/partner as well.
-- ============================================================================

create or replace function public.set_category_order(_org uuid, _order jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager', 'partner') then
    raise exception 'not authorized';
  end if;

  update orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{categoryOrder}', _order, true)
   where id = _org;
end $$;

grant execute on function public.set_category_order(uuid, jsonb) to authenticated;
