-- ============================================================================
-- 0026 · Delivery channels (Uber Eats / Wolt / Lieferando) — unified inbox
--
-- Orders from the delivery platforms currently live in three separate tablet
-- apps. This lands them all in DishData instead: each platform POSTs to
-- /api/channels/<provider>, we verify + normalize + store the raw payload,
-- then staff accept (or the channel auto-accepts) and a real `orders` row is
-- created so the ticket hits the Kitchen board and inventory depletes exactly
-- like a POS sale.
--
-- Two tables:
--   channels        — one row per org+provider: credentials, webhook secret,
--                     and the per-channel customisation settings.
--   channel_orders  — every inbound order, keyed by the platform's own order
--                     id for idempotency (platforms retry aggressively). Keeps
--                     the raw payload for audit/replay, plus a normalized
--                     `items` array resolved against our recipes.
--
-- PAYMENT METHOD: platform orders record a payment with method 'wallet' and
-- split_label = the provider, NOT a new 'platform' enum value. Two reasons:
-- (1) a value added to payment_method could not be used as an enum literal in
-- the same transaction that added it (the SQL editor runs a script as one
-- transaction — the gotcha hit in 0023), and (2) ZReport keys a Record by
-- PaymentMethod, so an unmapped value would render undefined. Revenue still
-- reconciles because order total == payment total. Giving platforms their own
-- method later needs its own migration plus a ZReport entry.
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

do $$ begin create type channel_provider as enum ('ubereats','wolt','lieferando');
exception when duplicate_object then null; end $$;

do $$ begin create type channel_order_status as enum ('pending','accepted','rejected','failed');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 1. Connected channels
-- ----------------------------------------------------------------------------
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider channel_provider not null,
  -- What the platform calls this location (their store/venue/restaurant id).
  external_store_id text not null default '',
  is_active boolean not null default false,
  -- Platform API credentials. Read is restricted to owner/admin (see RLS
  -- below) and the client API layer never selects this column — the Channels
  -- UI writes it and reads only `has_credentials`.
  credentials jsonb not null default '{}'::jsonb,
  -- Our shared secret: the platform signs inbound webhooks with it, and the
  -- ingest route passes it to accept_channel_order() to authorize auto-accept.
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  -- Per-channel customisation -----------------------------------------------
  -- Skip the pending tray and fire straight to the kitchen.
  auto_accept boolean not null default false,
  -- Quoted prep time sent back to the platform on accept.
  prep_minutes integer not null default 20,
  -- Commission the platform takes, for margin reporting (informational).
  commission_pct numeric not null default 30,
  -- Ring platform orders up at a markup vs the dine-in price. Applied when
  -- pushing our menu OUT to the platform, never to inbound order totals —
  -- inbound totals are always what the guest actually paid.
  price_markup_pct numeric not null default 0,
  -- Route these tickets to the kitchen board at all (false = handover only).
  send_to_kitchen boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  -- Reported to the client instead of the secret itself, so the Channels UI
  -- can show "credentials saved" without ever selecting `credentials`.
  has_credentials boolean generated always as (credentials <> '{}'::jsonb) stored,
  -- Health -----------------------------------------------------------------
  last_order_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  unique (org_id, provider)
);

-- ----------------------------------------------------------------------------
-- 2. Inbound orders (the unified inbox)
-- ----------------------------------------------------------------------------
create table if not exists public.channel_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  provider channel_provider not null,
  -- The platform's own id — the idempotency key for their webhook retries.
  external_id text not null,
  -- Short human code the courier/guest quotes (e.g. Wolt's "#4821").
  external_display_id text not null default '',
  status channel_order_status not null default 'pending',
  -- Set once accepted; null while pending/rejected.
  order_id uuid references public.orders(id) on delete set null,
  -- Normalized lines: [{ name, qty, price, recipe_id|null, notes }]. recipe_id
  -- is resolved by name at ingest; unmatched lines still ring up correctly,
  -- they just cannot deplete stock (surfaced as "unmapped" in the UI).
  items jsonb not null default '[]'::jsonb,
  gross numeric not null default 0,
  customer_name text not null default '',
  order_type order_type not null default 'delivery',
  notes text,
  -- Platform courier/pickup info, kept loose since each platform differs.
  fulfillment jsonb not null default '{}'::jsonb,
  -- Untouched original payload, for audit and for replaying a failed parse.
  raw jsonb not null default '{}'::jsonb,
  reject_reason text,
  received_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  unique (org_id, provider, external_id)
);

create index if not exists channel_orders_pending_idx
  on public.channel_orders (org_id, status, received_at desc);
create index if not exists channel_orders_order_idx
  on public.channel_orders (order_id);

-- ----------------------------------------------------------------------------
-- 3. Accept — creates the real order, depletes stock, records the payout
--
-- Authorized either by org membership (staff tapping Accept) or by the
-- channel's own webhook_secret (the ingest route auto-accepting). The secret
-- path exists because a webhook has no auth.uid(); it is not guessable across
-- orgs, so it cannot be used to touch another org's data.
-- ----------------------------------------------------------------------------
create or replace function public.accept_channel_order(
  _channel_order uuid,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  co record; ch record; it jsonb;
  _gross numeric := 0; _tax numeric; _subtotal numeric; _rate numeric;
  _no int; _order_id uuid; _order_number text; _items jsonb;
begin
  select * into co from channel_orders where id = _channel_order;
  if not found then raise exception 'channel order not found'; end if;
  select * into ch from channels where id = co.channel_id;
  if not found then raise exception 'channel not found'; end if;

  if not (is_org_member(co.org_id) or (_secret is not null and _secret = ch.webhook_secret)) then
    raise exception 'not authorized for this organization';
  end if;

  -- Idempotent: a retry (or a double-tap) returns the order already created.
  if co.status <> 'pending' then
    return jsonb_build_object('order_id', co.order_id, 'already_decided', true, 'status', co.status);
  end if;

  select tax_rate into _rate from orgs where id = co.org_id;

  -- Trust the platform's line prices — that is what the guest actually paid.
  for it in select * from jsonb_array_elements(co.items) loop
    _gross := _gross + (it->>'price')::numeric * (it->>'qty')::numeric;
  end loop;
  -- Fall back to the payload's own total if the lines did not carry prices.
  if _gross = 0 then _gross := co.gross; end if;

  -- VAT-included (gross) pricing, matching checkout_order (0017/0025).
  _tax := round(_gross * _rate / (100 + _rate), 2);
  _subtotal := round(_gross - _tax, 2);

  update orgs set next_order_no = next_order_no + 1
    where id = co.org_id returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  -- Strip our internal recipe_id resolution out of the stored line items so
  -- `orders.items` keeps the same shape POS writes.
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', it.value->>'recipe_id',
           'name', it.value->>'name',
           'qty', (it.value->>'qty')::numeric,
           'price', (it.value->>'price')::numeric
         )), '[]'::jsonb)
    into _items
    from jsonb_array_elements(co.items) it;

  insert into orders (
    org_id, order_number, order_type, customer_id, guest_name, items,
    subtotal, tax, tip, total, discount, status, kitchen_status, kitchen_notes, source
  ) values (
    co.org_id, _order_number, co.order_type, null,
    nullif(co.customer_name, ''), _items,
    _subtotal, _tax, 0, round(_gross, 2), 0,
    'paid',                                    -- the platform already collected
    case when ch.send_to_kitchen then 'new'::kitchen_status else 'served'::kitchen_status end,
    co.notes, co.provider::text
  ) returning id into _order_id;

  -- Payout leg so takings/Z-report reconcile (see header note on 'wallet').
  insert into payments (org_id, order_id, method, amount, tip_amount, split_label)
  values (co.org_id, _order_id, 'wallet', round(_gross, 2), 0, co.provider::text);

  -- Deplete stock for lines we could map to a recipe.
  update inventory_items inv
  set stock = greatest(0, inv.stock - usage.used)
  from (
    select ri.inventory_item_id, sum(ri.qty_numeric * (it.value->>'qty')::numeric) as used
    from jsonb_array_elements(co.items) it
    join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
    where ri.inventory_item_id is not null and ri.org_id = co.org_id
      and it.value->>'recipe_id' is not null
    group by ri.inventory_item_id
  ) usage
  where inv.id = usage.inventory_item_id;

  insert into inventory_transactions (org_id, item_id, item_name, delta, reason, ref_order_id)
  select co.org_id, ri.inventory_item_id, ri.name,
         -sum(ri.qty_numeric * (it.value->>'qty')::numeric), 'sale', _order_id
  from jsonb_array_elements(co.items) it
  join recipe_ingredients ri on ri.recipe_id = (it.value->>'recipe_id')::uuid
  where ri.inventory_item_id is not null and ri.org_id = co.org_id
    and it.value->>'recipe_id' is not null
  group by ri.inventory_item_id, ri.name;

  if co.order_type = 'delivery' then
    insert into deliveries (org_id, order_id, address, status)
    values (co.org_id, _order_id,
            coalesce(co.fulfillment->>'address', ''), 'pending');
  end if;

  update channel_orders
  set status = 'accepted', order_id = _order_id, decided_at = now(), decided_by = auth.uid()
  where id = _channel_order;

  update channels set last_order_at = now(), last_error = null where id = co.channel_id;

  return jsonb_build_object(
    'order_id', _order_id, 'order_number', _order_number,
    'total', round(_gross, 2), 'already_decided', false
  );
end $$;

-- ----------------------------------------------------------------------------
-- 4. Reject — no order is created; the record stays for reporting.
-- ----------------------------------------------------------------------------
create or replace function public.reject_channel_order(
  _channel_order uuid,
  _reason text default null,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare co record; ch record;
begin
  select * into co from channel_orders where id = _channel_order;
  if not found then raise exception 'channel order not found'; end if;
  select * into ch from channels where id = co.channel_id;

  if not (is_org_member(co.org_id) or (_secret is not null and _secret = ch.webhook_secret)) then
    raise exception 'not authorized for this organization';
  end if;

  if co.status <> 'pending' then
    return jsonb_build_object('already_decided', true, 'status', co.status);
  end if;

  update channel_orders
  set status = 'rejected', reject_reason = _reason,
      decided_at = now(), decided_by = auth.uid()
  where id = _channel_order;

  return jsonb_build_object('already_decided', false, 'status', 'rejected');
end $$;

-- ----------------------------------------------------------------------------
-- 5. Triggers + RLS
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  execute 'drop trigger if exists set_updated_at on public.channels';
  execute 'create trigger set_updated_at before update on public.channels for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists set_created_by on public.channels';
  execute 'create trigger set_created_by before insert on public.channels for each row execute function public.set_created_by()';

  foreach t in array array['channels','channel_orders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_member_select on public.%I', t, t);
    execute format('drop policy if exists %I_member_insert on public.%I', t, t);
    execute format('drop policy if exists %I_member_update on public.%I', t, t);
    execute format('drop policy if exists %I_manager_delete on public.%I', t, t);
  end loop;

  -- channel_orders: any member can see and decide on the inbox.
  execute 'create policy channel_orders_member_select on public.channel_orders for select using (is_org_member(org_id))';
  execute 'create policy channel_orders_member_insert on public.channel_orders for insert with check (is_org_member(org_id))';
  execute 'create policy channel_orders_member_update on public.channel_orders for update using (is_org_member(org_id))';
  execute 'create policy channel_orders_manager_delete on public.channel_orders for delete using (has_org_role(org_id,''owner'',''admin'',''manager''))';

  -- channels holds API credentials → owner/admin only, all verbs.
  execute 'create policy channels_admin_select on public.channels for select using (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_insert on public.channels for insert with check (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_update on public.channels for update using (has_org_role(org_id,''owner'',''admin''))';
  execute 'create policy channels_admin_delete on public.channels for delete using (has_org_role(org_id,''owner'',''admin''))';
end $$;

-- ----------------------------------------------------------------------------
-- 6. Register the module (FK from member_module_access requires it first).
--    Grant only to members who already have explicit per-module rows — see
--    0022 for why a lone row would otherwise hide every other module.
-- ----------------------------------------------------------------------------
insert into public.modules (id, name, grouping, sort)
values ('channels', 'Delivery Channels', 'Operate', 12)
on conflict (id) do update set name = excluded.name, grouping = excluded.grouping;

-- Live inbox: the pending tray subscribes to inserts.
do $$ begin alter publication supabase_realtime add table public.channel_orders;
exception when duplicate_object then null; end $$;

insert into public.member_module_access (org_id, user_id, module_id, can_access)
select distinct om.org_id, om.user_id, 'channels', true
from public.org_members om
where om.role::text in ('owner','admin')
  and exists (
    select 1 from public.member_module_access ma
    where ma.org_id = om.org_id and ma.user_id = om.user_id
  )
on conflict (org_id, user_id, module_id) do nothing;
