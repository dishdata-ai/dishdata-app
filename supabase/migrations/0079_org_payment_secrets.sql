-- ============================================================================
-- 0079 · A restaurant's own Stripe keys (direct mode)
--
-- A restaurant with its own registered company can use its OWN Stripe account
-- directly instead of Stripe Connect: it pastes its secret key (and the signing
-- secret of a webhook it creates) in Settings → Payments. The money goes
-- straight to its Stripe account; DishData takes no platform fee.
--
-- Secrets live here, in a table nobody can read through the API: RLS is enabled
-- with no policies on purpose, so only the server (service role) can read or write
-- it. The browser never gets the keys back.
-- ============================================================================

create table if not exists public.org_payment_secrets (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  stripe_secret_key text,
  stripe_webhook_secret text,
  updated_at timestamptz not null default now()
);

alter table public.org_payment_secrets enable row level security;
