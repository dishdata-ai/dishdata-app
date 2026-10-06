-- ============================================================================
-- 0077 · Remember that a website order's confirmation email has been sent
--
-- The confirmation (guest) and alert (restaurant) emails are sent by the app
-- server. This column makes it safe to ask twice: whoever stamps it first sends
-- the emails, everyone else does nothing, so a double click or a retried Stripe
-- webhook never emails the guest twice.
-- ============================================================================

alter table public.orders add column if not exists notified_at timestamptz;
