-- ============================================================================
-- 0081 · Website traffic, counted by us
--
-- An anonymous, cookie-free counter for a restaurant's website, so the numbers cover
-- every visitor and not only those who accepted analytics cookies (Google Analytics
-- only sees those). It stores NO personal data: no IP address, no user agent, no
-- cookie or device id. A visit id exists only in the page's memory and is gone on reload.
--
--   kind        page_view, add_to_cart, begin_checkout, begin_payment, purchase,
--               generate_lead, table_scan, click_delivery_partner, login
--   visit_id    random, per page load (lets us count visits and funnel steps)
--   device      mobile / tablet / desktop (from the screen width)
--   referrer    the host the visitor came from (never the full address)
--
-- Anyone can ADD an event through track_site_event() (validated, size-limited, rate
-- limited); only staff (owner, admin, partner, manager) can read the numbers, through
-- site_stats(). The table itself has no policies, so it cannot be read directly.
-- Keep it lean: delete events older than 24 months from time to time.
-- ============================================================================

create table if not exists public.site_events (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  visit_id text,
  path text,
  item text,
  order_type text,
  table_name text,
  partner text,
  lead_type text,
  value numeric,
  device text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  lang text
);
create index if not exists site_events_org_at_idx on public.site_events (org_id, at desc);
create index if not exists site_events_org_kind_at_idx on public.site_events (org_id, kind, at desc);
alter table public.site_events enable row level security;

create or replace function public.track_site_event(
  _slug text, _kind text, _visit text default null, _path text default null, _item text default null,
  _order_type text default null, _table text default null, _partner text default null, _lead_type text default null,
  _value numeric default null, _device text default null, _referrer text default null,
  _utm_source text default null, _utm_medium text default null, _utm_campaign text default null, _lang text default null
) returns void language plpgsql security definer set search_path = public as $$
declare _org uuid;
begin
  if _kind not in ('page_view','add_to_cart','begin_checkout','begin_payment','purchase','generate_lead','table_scan','click_delivery_partner','login') then
    return;
  end if;
  select id into _org from orgs where slug = _slug;
  if _org is null then return; end if;
  -- Soft cap against floods: at most 600 events a minute per restaurant.
  if (select count(*) from site_events where org_id = _org and at > now() - interval '1 minute') > 600 then return; end if;
  insert into site_events (org_id, kind, visit_id, path, item, order_type, table_name, partner, lead_type, value, device, referrer, utm_source, utm_medium, utm_campaign, lang)
  values (_org, _kind, left(_visit, 24), left(_path, 160), left(_item, 120), left(_order_type, 20), left(_table, 24), left(_partner, 40), left(_lead_type, 40),
          _value, case when _device in ('mobile','tablet','desktop') then _device end, left(_referrer, 80),
          left(_utm_source, 60), left(_utm_medium, 60), left(_utm_campaign, 80), left(_lang, 5));
end $$;
grant execute on function public.track_site_event(text,text,text,text,text,text,text,text,text,numeric,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.site_stats(_slug text, _days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare _org uuid; _since timestamptz; _days_c int := greatest(1, least(coalesce(_days, 30), 365));
begin
  select id into _org from orgs where slug = _slug;
  if _org is null then raise exception 'restaurant not found'; end if;
  if not has_org_role(_org, 'owner', 'admin', 'partner', 'manager') then raise exception 'not allowed'; end if;
  _since := now() - make_interval(days => _days_c);

  return jsonb_build_object(
    'days', _days_c,
    'totals', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, count(*) n from site_events where org_id = _org and at >= _since group by kind) t),
    -- Distinct visits that reached each step, for the funnel.
    'funnel', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
        select kind, count(distinct visit_id) n from site_events
         where org_id = _org and at >= _since and kind in ('page_view','add_to_cart','begin_checkout','begin_payment','purchase')
         group by kind) t),
    'revenue', coalesce((select sum(value) from site_events where org_id = _org and at >= _since and kind = 'purchase'), 0),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'visits', v, 'orders', o) order by d), '[]'::jsonb) from (
        select (at at time zone 'Europe/Berlin')::date d,
               count(distinct visit_id) filter (where kind = 'page_view') v,
               count(*) filter (where kind = 'purchase') o
          from site_events where org_id = _org and at >= _since group by 1) x),
    'top_pages', (select coalesce(jsonb_agg(jsonb_build_object('label', path, 'n', n) order by n desc), '[]'::jsonb) from (
        select path, count(*) n from site_events where org_id = _org and at >= _since and kind = 'page_view' and path is not null group by path order by n desc limit 10) x),
    'top_dishes', (select coalesce(jsonb_agg(jsonb_build_object('label', item, 'n', n) order by n desc), '[]'::jsonb) from (
        select item, count(*) n from site_events where org_id = _org and at >= _since and kind = 'add_to_cart' and item is not null group by item order by n desc limit 10) x),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('label', table_name, 'n', n) order by n desc), '[]'::jsonb) from (
        select table_name, count(*) n from site_events where org_id = _org and at >= _since and kind = 'table_scan' and table_name is not null group by table_name order by n desc limit 20) x),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('label', device, 'n', n) order by n desc), '[]'::jsonb) from (
        select device, count(distinct visit_id) n from site_events where org_id = _org and at >= _since and kind = 'page_view' and device is not null group by device) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('label', src, 'n', n) order by n desc), '[]'::jsonb) from (
        select coalesce(nullif(utm_source, ''), nullif(referrer, ''), 'direct') src, count(distinct visit_id) n
          from site_events where org_id = _org and at >= _since and kind = 'page_view' group by 1 order by n desc limit 10) x),
    'partners', (select coalesce(jsonb_agg(jsonb_build_object('label', partner, 'n', n) order by n desc), '[]'::jsonb) from (
        select partner, count(*) n from site_events where org_id = _org and at >= _since and kind = 'click_delivery_partner' and partner is not null group by partner) x),
    'order_types', (select coalesce(jsonb_agg(jsonb_build_object('label', order_type, 'n', n) order by n desc), '[]'::jsonb) from (
        select order_type, count(*) n from site_events where org_id = _org and at >= _since and kind in ('purchase','begin_payment') and order_type is not null group by order_type) x)
  );
end $$;
grant execute on function public.site_stats(text, int) to authenticated;
revoke execute on function public.site_stats(text, int) from anon, public;
