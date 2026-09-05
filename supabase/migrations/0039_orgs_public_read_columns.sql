-- ============================================================================
-- 0039 · Restrict anon reads on orgs to the columns the storefront actually
-- uses.
--
-- orgs_public_read (0001) is `for select to anon using (true)` — a ROW-level
-- policy with no row restriction at all. RLS only ever filters rows, never
-- columns, so every column of every org is currently readable by anyone with
-- the anon key, via a direct REST call, with no app code involved.
--
-- That was a passive gap until this week: `settings` now carries a
-- restaurant's fiskaly TSE credentials (tssId, clientId) once TSE is turned
-- on, alongside printer config, staff-discount rules, and a target food-cost
-- percentage — none of it meant to be public. Our own app code (public.ts /
-- public-server.ts) already forwards only what the storefront needs, but
-- that only protects requests going through our API. Anyone with the anon
-- key querying Supabase directly still gets everything.
--
-- Postgres enforces column privileges independently of RLS, so this closes
-- the gap at the level nothing else can bypass: `anon` loses table-wide
-- SELECT and is re-granted only the columns the public storefront actually
-- reads (see PublicMenu["org"] in src/lib/api/public.ts). `authenticated`
-- keeps full column access — orgs_member_read still gates that to a member's
-- own org, unaffected by this migration.
-- ============================================================================

revoke select on public.orgs from anon;
grant select (id, name, slug, logo_url, accent_color, currency, tax_rate) on public.orgs to anon;
