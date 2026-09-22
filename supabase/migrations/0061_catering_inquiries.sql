-- ============================================================================
-- 0061 · Catering menu + spend-tier discounts
--
-- A shareable public page listing every dish, for the customers who ask
-- "can I get a menu for catering." Building an order there doesn't check
-- out like the QR menu does — catering needs a human to confirm date,
-- headcount and logistics — so submitting sends a request the restaurant
-- reviews, the same shape as place_public_reservation already uses for
-- table bookings.
--
-- Spend-tier discounts ("order over €300, get 10% off") live in
-- orgs.settings.cateringTiers, the same catch-all JSON blob category order
-- already uses — no new column needed, and a manager can edit it without a
-- migration. Only that one key is ever exposed to the public route (see
-- publicCateringTiers() in src/lib/api/public.ts), same as
-- publicCategoryOrder() already does for settings.categoryOrder.
-- ============================================================================

create table if not exists public.catering_inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  guest_name text not null,
  phone text not null,
  email text,
  event_date date,
  headcount int,
  notes text,
  -- Snapshot of what they picked and its price at request time — a later
  -- price change on a recipe must not silently reprice a pending request.
  items jsonb not null default '[]'::jsonb,
  subtotal numeric not null default 0,
  discount_pct numeric not null default 0,
  status text not null default 'new' check (status in ('new', 'contacted', 'confirmed', 'declined')),
  created_at timestamptz not null default now()
);

create index if not exists catering_inquiries_org_idx on public.catering_inquiries (org_id, created_at desc);

alter table public.catering_inquiries enable row level security;

drop policy if exists catering_member_read on public.catering_inquiries;
create policy catering_member_read on public.catering_inquiries for select using (is_org_member(org_id));

drop policy if exists catering_member_update on public.catering_inquiries;
create policy catering_member_update on public.catering_inquiries for update using (is_org_member(org_id));

-- No insert policy for anon/authenticated — inserts only ever come through
-- place_catering_inquiry() below, same reasoning as place_public_reservation:
-- a public visitor should be able to submit a request, never read or edit
-- anyone else's.

create or replace function public.place_catering_inquiry(
  _slug text,
  _guest_name text,
  _phone text,
  _email text default null,
  _event_date date default null,
  _headcount int default null,
  _notes text default null,
  _items jsonb default '[]'::jsonb,
  _subtotal numeric default 0,
  _discount_pct numeric default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare _org uuid; _id uuid;
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if _guest_name is null or length(trim(_guest_name)) = 0 then raise exception 'name is required'; end if;
  if _phone is null or length(trim(_phone)) = 0 then raise exception 'phone is required'; end if;

  insert into catering_inquiries
    (org_id, guest_name, phone, email, event_date, headcount, notes, items, subtotal, discount_pct)
  values
    (_org, trim(_guest_name), trim(_phone), nullif(trim(coalesce(_email, '')), ''), _event_date,
     _headcount, _notes, _items, greatest(_subtotal, 0), greatest(_discount_pct, 0))
  returning id into _id;

  insert into notifications (org_id, type, title, body, ref)
  values (
    _org, 'catering', 'New catering request: ' || trim(_guest_name),
    coalesce(_headcount::text || ' guests · ', '') || '€' || round(_subtotal)::text ||
      case when _discount_pct > 0 then ' (' || _discount_pct::text || '% off)' else '' end,
    'recipes'
  );

  return jsonb_build_object('inquiry_id', _id);
end $$;

grant execute on function public.place_catering_inquiry to anon;

-- Mirrors set_category_order (0054): a manager/partner can edit the
-- discount tiers without the whole orgs row (payment/TSE credentials
-- included) opening up to their write access.
create or replace function public.set_catering_tiers(_org uuid, _tiers jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not has_org_role(_org, 'owner', 'admin', 'manager', 'partner') then
    raise exception 'not authorized';
  end if;

  update orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{cateringTiers}', _tiers, true)
   where id = _org;
end $$;

grant execute on function public.set_catering_tiers(uuid, jsonb) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.catering_inquiries;
exception when duplicate_object then null;
end $$;
