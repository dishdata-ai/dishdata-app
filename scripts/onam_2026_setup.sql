-- Create the Onam Sadhya 2026 preorder event for Kokoland.
-- Paste into the Supabase SQL editor (this repo's migration workflow).
--
-- This creates the EVENT only. The orders themselves are loaded through the
-- Import button in Preorders, by pasting the form export — deliberately, for
-- two reasons:
--   1. The importer synthesizes each row's dedupe id from the export itself,
--      so a later re-paste of the same export updates those rows instead of
--      duplicating them. Rows inserted by hand here would not carry a matching
--      id and would silently double up the next time anyone imports.
--   2. Guest names, emails, phone numbers and home addresses should not be
--      committed to a git repository.
--
-- Safe to run more than once: it updates the event in place rather than
-- creating a second one.

do $$
declare
  -- ↓↓↓ Set this to the restaurant's org slug before running. ↓↓↓
  _org_slug text := 'kokoland';

  _org_id uuid;
  _event_id uuid;
  _secret text;
begin
  select id into _org_id from public.orgs where slug = _org_slug;
  if _org_id is null then
    raise exception 'No org with slug "%". Check the slug in the app under Settings.', _org_slug;
  end if;

  select id into _event_id
  from public.preorder_events
  where org_id = _org_id and name = 'Onam Sadhya 2026';

  if _event_id is null then
    insert into public.preorder_events (
      org_id, name, is_active, service_dates,
      slot_minutes, day_start_hour, day_end_hour, dine_in_capacity
    ) values (
      _org_id, 'Onam Sadhya 2026', true,
      array['2026-08-22','2026-08-26','2026-08-29','2026-08-30']::date[],
      60, 11, 22, 20
    )
    returning id, webhook_secret into _event_id, _secret;
    raise notice 'Created event %', _event_id;
  else
    update public.preorder_events
    set service_dates = array['2026-08-22','2026-08-26','2026-08-29','2026-08-30']::date[],
        day_start_hour = 11,
        day_end_hour = 22,
        dine_in_capacity = 20,
        is_active = true
    where id = _event_id
    returning webhook_secret into _secret;
    raise notice 'Updated existing event %', _event_id;
  end if;

  raise notice '--------------------------------------------------------------';
  raise notice 'Event id:       %', _event_id;
  raise notice 'Webhook secret: %', _secret;
  raise notice 'Webhook URL:    https://<your-app-host>/api/webhooks/preorders/%?secret=%', _event_id, _secret;
  raise notice '--------------------------------------------------------------';
  raise notice 'Next: open Preorders in the app, click Import, and paste the';
  raise notice 'form export (including its header row) to load the orders.';
end $$;
