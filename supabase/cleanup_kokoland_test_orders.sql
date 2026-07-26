-- ============================================================================
-- One-time cleanup: remove kokoland-berlin's TEST orders before go-live.
-- Safe because these are pre-launch test rows, not real sales. Deleting an
-- order cascades to its payments and receipts via their FKs. The order/receipt
-- COUNTERS are intentionally left as-is, so the first real order continues from
-- where testing left off (e.g. ORD-0010) rather than restarting at 0001.
--
-- Touches ONLY kokoland-berlin. Big Brewsky (the test org) is untouched.
-- ============================================================================

delete from public.orders
where org_id = (select id from public.orgs where slug = 'kokoland-berlin');

-- Verify: should return 0.
select count(*) as remaining_orders
from public.orders o
join public.orgs g on g.id = o.org_id
where g.slug = 'kokoland-berlin';
