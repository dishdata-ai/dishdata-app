-- ============================================================================
-- 0043 · SumUp as a sales channel — till sales land in DishData
--
-- While SumUp is the till, every sale happens in SumUp's app/terminal and
-- DishData never hears about it: stock never depletes and Sales/Reports stay
-- empty. This adds SumUp as a fourth channel next to Wolt / Uber Eats /
-- Lieferando. Unlike them it is PULLED, not pushed — SumUp has no webhook for
-- in-person payments — so /api/channels/sync (Sync now + auto-sync while the
-- Channels page is open) and /api/cron/sumup-sync (for a scheduler) read the
-- transaction history and import each successful sale through the same
-- channel_orders → accept_channel_order path, so stock depletes exactly like a
-- sale rung up in DishData.
--
-- accept_channel_order changes (every provider):
--   * per-line VAT: the line's own tax_rate (SumUp sends one), else the recipe
--     override, else the org default — extracted per rate group like
--     checkout_order (0032). Before, every platform order was taxed at the
--     org rate, which under-taxed drinks.
--   * orders.items now carries tax_rate, the same shape checkout_order writes.
-- SumUp only:
--   * the order and payment keep the sale's own timestamp — a sync can run
--     minutes or hours later and reports must bucket it on the day it sold;
--   * the charged amount is authoritative — a till-side discount is recorded
--     as orders.discount rather than inflating revenue to list prices;
--   * tip → orders.tip / payments.tip_amount, and the method is card or cash
--     as SumUp reports it (cash therefore counts in an open till session).
--
-- ENUM GOTCHA: 'sumup' is added to channel_provider in this same script, so it
-- is only ever compared as provider::text = 'sumup', never as an enum literal
-- (see 0023/0026).
--
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

alter type channel_provider add value if not exists 'sumup';

create or replace function public.accept_channel_order(
  _channel_order uuid,
  _secret text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  co record; ch record; grp record;
  _rate numeric; _is_pos boolean; _at timestamptz; _method payment_method;
  _lines numeric := 0; _gross numeric; _discount numeric := 0; _tip numeric := 0;
  _tax numeric := 0; _subtotal numeric;
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

  -- A till sale (SumUp) already happened at the counter, with its own time,
  -- tip and tender. A platform order happens now and is paid out by the
  -- platform (see 0026 on 'wallet').
  _is_pos := co.provider::text = 'sumup';
  _at := case when _is_pos then co.received_at else now() end;
  if _is_pos then
    _tip := greatest(coalesce((co.fulfillment->>'tip')::numeric, 0), 0);
    _method := case when upper(coalesce(co.fulfillment->>'payment_type', '')) = 'CASH'
                    then 'cash'::payment_method else 'card'::payment_method end;
  else
    _method := 'wallet'::payment_method;
  end if;

  -- Lines in the shape POS writes, snapshotting each line's VAT rate: the
  -- channel's own, else the recipe override, else the org default.
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', it.value->>'recipe_id',
           'name', it.value->>'name',
           'qty', (it.value->>'qty')::numeric,
           'price', (it.value->>'price')::numeric,
           'tax_rate', coalesce((it.value->>'tax_rate')::numeric, r.tax_rate, _rate)
         ) order by it.ord), '[]'::jsonb)
    into _items
    from jsonb_array_elements(co.items) with ordinality as it(value, ord)
    left join recipes r on r.id = (it.value->>'recipe_id')::uuid and r.org_id = co.org_id;

  select coalesce(sum((i.value->>'price')::numeric * (i.value->>'qty')::numeric), 0)
    into _lines
    from jsonb_array_elements(_items) i;

  -- Platforms: trust the line prices (what the guest paid), else the payload
  -- total. Till: what was charged is authoritative; lines above it were
  -- discounted at the counter.
  if _is_pos and co.gross > 0 then _gross := co.gross;
  elsif _lines > 0 then _gross := _lines;
  else _gross := co.gross;
  end if;
  _discount := round(greatest(_lines - _gross, 0), 2);

  -- VAT-included pricing, extracted per rate group with any discount spread
  -- proportionally — the same method as checkout_order (0032).
  if _lines > 0 then
    for grp in
      select (i.value->>'tax_rate')::numeric as rate,
             sum((i.value->>'price')::numeric * (i.value->>'qty')::numeric) as gross
      from jsonb_array_elements(_items) i
      group by 1
    loop
      _tax := _tax + round(
        greatest(grp.gross - _discount * grp.gross / _lines, 0) * grp.rate / (100 + grp.rate), 2);
    end loop;
  else
    _tax := round(_gross * _rate / (100 + _rate), 2);
  end if;
  _subtotal := round(_gross - _tax, 2);

  update orgs set next_order_no = next_order_no + 1
    where id = co.org_id returning next_order_no - 1 into _no;
  _order_number := 'ORD-' || lpad(_no::text, 4, '0');

  insert into orders (
    org_id, order_number, order_type, customer_id, guest_name, items,
    subtotal, tax, tip, total, discount, status, kitchen_status, kitchen_notes, source, created_at
  ) values (
    co.org_id, _order_number, co.order_type, null,
    nullif(co.customer_name, ''), _items,
    _subtotal, _tax, _tip, round(_gross + _tip, 2), _discount,
    'paid',                                    -- the platform / till already collected
    case when ch.send_to_kitchen then 'new'::kitchen_status else 'served'::kitchen_status end,
    co.notes, co.provider::text, _at
  ) returning id into _order_id;

  -- Payment leg so takings/Z-report reconcile.
  insert into payments (org_id, order_id, method, amount, tip_amount, split_label, created_at)
  values (co.org_id, _order_id, _method, round(_gross, 2), _tip, co.provider::text, _at);

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

  update channels
  set last_order_at = greatest(coalesce(last_order_at, _at), _at), last_error = null
  where id = co.channel_id;

  return jsonb_build_object(
    'order_id', _order_id, 'order_number', _order_number,
    'total', round(_gross + _tip, 2), 'already_decided', false
  );
end $$;

-- The module now covers the till as well as delivery.
update public.modules set name = 'Sales Channels' where id = 'channels';
