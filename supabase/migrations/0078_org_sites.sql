-- ============================================================================
-- 0078 · Website, brand and email settings per restaurant
--
-- Until now one restaurant's identity lived in server environment variables
-- (site address, email sender, alert address). That cannot serve a second
-- restaurant. Each org now stores its own in one row:
--
--   site_url           its own website, e.g. https://kokoland.de. Table QR codes,
--                      email links and payment return pages point here.
--   display_name, logo_url, primary_color   brand for emails and pages
--   table_path         where a table QR lands, "{table}" is replaced, e.g. /t/{table}
--   custom_domain      a domain DishData itself serves the storefront on (later)
--   from_name / from_address / reply_to / staff_alert_email / email_domain...
--                      email identity, and the state of the sending-domain check
--
-- Staff-only (RLS): the email addresses are private. The website reads the
-- public part (site, name, logo, colour) through get_site_info().
--
-- auth_code_requests backs the rate limit on emailed sign-in codes.
-- ============================================================================

create table if not exists public.org_sites (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  site_url text,
  display_name text,
  logo_url text,
  primary_color text,
  table_path text not null default '/t/{table}',
  custom_domain text unique,
  from_name text,
  from_address text,
  reply_to text,
  staff_alert_email text,
  email_domain text,
  resend_domain_id text,
  email_domain_status text not null default 'none' check (email_domain_status in ('none','pending','verified','failed')),
  email_dns_records jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists org_sites_updated_at on public.org_sites;
create trigger org_sites_updated_at before update on public.org_sites
  for each row execute function public.set_updated_at();

alter table public.org_sites enable row level security;

drop policy if exists org_sites_member_read on public.org_sites;
create policy org_sites_member_read on public.org_sites for select using (is_org_member(org_id));

drop policy if exists org_sites_admin_write on public.org_sites;
create policy org_sites_admin_write on public.org_sites for all
  using (has_org_role(org_id, 'owner', 'admin'))
  with check (has_org_role(org_id, 'owner', 'admin'));

-- The public part, for the restaurant's website and hosted pages.
create or replace function public.get_site_info(_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
        'site_url', s.site_url, 'display_name', coalesce(s.display_name, o.name),
        'logo_url', s.logo_url, 'primary_color', s.primary_color, 'table_path', s.table_path)
       from orgs o left join org_sites s on s.org_id = o.id where o.slug = _slug),
    '{}'::jsonb);
$$;
grant execute on function public.get_site_info(text) to anon, authenticated;

-- Sign-in code requests (service role only; no policies on purpose).
create table if not exists public.auth_code_requests (
  id bigserial primary key,
  email text not null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists auth_code_requests_email_idx on public.auth_code_requests (email, created_at desc);
create index if not exists auth_code_requests_ip_idx on public.auth_code_requests (ip, created_at desc);
alter table public.auth_code_requests enable row level security;
