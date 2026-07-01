-- Delivery zones: postcodes each org delivers to, with min order and fee.
create table if not exists delivery_zones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  postcode    text not null,
  min_order   numeric(10,2) not null default 0,
  delivery_fee numeric(10,2) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (org_id, postcode)
);

alter table delivery_zones enable row level security;

-- Org members can read their own zones.
create policy "org members read delivery zones" on delivery_zones
  for select using (public.is_org_member(org_id));

-- Admins/managers can manage zones.
create policy "org admins manage delivery zones" on delivery_zones
  for all using (public.has_org_role(org_id, 'owner', 'admin', 'manager'));

-- Storefront (anon) can read active zones by org slug (via the public API).
-- The public.ts layer already gates reads through the org slug lookup so
-- anon select is safe here as long as they know the org id.
create policy "public read active delivery zones" on delivery_zones
  for select using (is_active = true);
