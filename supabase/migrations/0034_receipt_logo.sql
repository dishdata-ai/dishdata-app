-- ============================================================================
-- 0034 · Separate receipt logo
--
-- orgs.logo_url is used everywhere — sidebar, public menu, storefront — and
-- restaurants often make that a square mark with a solid background color
-- (see Kokoland's, a green square). That reads fine in a sidebar avatar, but
-- on a receipt it's the only graphic on an otherwise plain page, and a solid
-- background block is exactly what a monochrome thermal printer renders
-- worst: a big flat black square rather than a clean mark.
--
-- receipt_logo_url is a second, optional slot for a transparent-background
-- version, used only on receipts/invoices. Null falls back to logo_url so
-- nothing changes for orgs that don't set one.
-- ============================================================================

alter table public.orgs add column if not exists receipt_logo_url text;
