-- ============================================================================
-- 0065 · Backfill org.settings.enabled_modules for kitchenops/dailytasks
--
-- kitchenops and dailytasks are staying on ALWAYS_ENABLED_MODULES in most
-- respects, but that frontend list is being trimmed so their Settings pill
-- stops being locked "(core)" — i.e. an owner can genuinely turn either off
-- per org, like almost every other module.
--
-- Confirmed live: both real orgs (Kokoland Berlin, Big Brewsky) have an
-- EXPLICIT settings.enabled_modules array that predates these two module ids
-- (added earlier today) — neither array contains them. Without this backfill,
-- removing the ALWAYS_ENABLED_MODULES bypass would immediately hide both
-- features for every existing org, the exact failure mode that constant
-- exists to prevent in the first place.
--
-- Only touches orgs with an explicit array (missing the key already means
-- "every module", so there's nothing to add). Idempotent — re-running just
-- re-confirms membership, dedup via array_agg(distinct ...).
-- ============================================================================

update public.orgs
set settings = jsonb_set(
  settings,
  '{enabled_modules}',
  (
    select to_jsonb(array_agg(distinct m))
    from jsonb_array_elements_text(settings->'enabled_modules' || '["kitchenops","dailytasks"]'::jsonb) as m
  )
)
where settings ? 'enabled_modules'
  and not (
    settings->'enabled_modules' @> '["kitchenops"]'
    and settings->'enabled_modules' @> '["dailytasks"]'
  );
