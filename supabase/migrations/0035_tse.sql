-- ============================================================================
-- 0035 · TSE (Technische Sicherheitseinrichtung) — KassenSichV §146a AO
--
-- German law requires every transaction on an electronic recording system with
-- a cash function to be signed by a certified TSE, and the signature data to
-- appear on the customer's receipt. This lands the storage half: the fields a
-- signature produces, plus a function to attach one to an order after the fact.
--
-- WHY A SEPARATE FUNCTION RATHER THAN MORE PARAMS ON checkout_order:
-- Signing is an HTTP call to fiskaly's cloud TSE. A Postgres function cannot
-- (and must not) make one — it would run inside the checkout transaction, where
-- a slow or failed request would hold locks or roll back a completed sale. So
-- the API route creates the order first, signs it, then calls this to record
-- the result. checkout_order keeps the signature it has had since 0033, which
-- also means this migration cannot break the existing checkout path.
--
-- FAILURE IS A FIRST-CLASS STATE, NOT AN ERROR. When the TSE is unreachable the
-- sale must still complete: the law requires the outage to be logged with a
-- reason and the receipt to show the signature is missing. `tse_status` carries
-- that, and a failed sale is never silently indistinguishable from a signed one.
-- ============================================================================

do $$ begin
  create type tse_status as enum ('signed', 'failed', 'not_required');
exception when duplicate_object then null; end $$;

alter table public.orders
  -- 'not_required' is the default so every pre-TSE order, and every order at a
  -- restaurant that hasn't enabled TSE, reads correctly rather than as a failure.
  add column if not exists tse_status tse_status not null default 'not_required',
  -- Straight from the fiskaly transaction response. Names mirror the API so the
  -- mapping to the receipt fields stays obvious.
  add column if not exists tse_transaction_number bigint,
  add column if not exists tse_signature_counter bigint,
  add column if not exists tse_signature text,
  add column if not exists tse_serial_number text,
  add column if not exists tse_time_start timestamptz,
  add column if not exists tse_time_end timestamptz,
  add column if not exists tse_timestamp_format text,
  add column if not exists tse_signature_algorithm text,
  add column if not exists tse_public_key text,
  add column if not exists tse_client_serial text,
  -- The whole QR payload, which the KassenSichV lets us print instead of every
  -- field in plain text. fiskaly returns it built; we never assemble it here.
  add column if not exists tse_qr_data text,
  -- Why a signature is missing, for the Verfahrensdokumentation.
  add column if not exists tse_error text;

-- Auditors ask "show me everything unsigned in this period", so that has to be
-- an index lookup rather than a scan of every order ever taken.
create index if not exists orders_tse_failed_idx
  on public.orders (org_id, created_at)
  where tse_status = 'failed';

-- ----------------------------------------------------------------------------
-- Attach a TSE result (success or failure) to an order.
--
-- Deliberately write-once: a signature may be recorded exactly once and can
-- never be overwritten or removed. Being able to re-sign an order after the
-- fact is precisely the manipulation the law exists to prevent, so a second
-- call raises rather than silently updating.
-- ----------------------------------------------------------------------------
create or replace function public.attach_tse_signature(
  _order_id uuid,
  _status text,
  _transaction_number bigint default null,
  _signature_counter bigint default null,
  _signature text default null,
  _serial_number text default null,
  _time_start timestamptz default null,
  _time_end timestamptz default null,
  _timestamp_format text default null,
  _signature_algorithm text default null,
  _public_key text default null,
  _client_serial text default null,
  _qr_data text default null,
  _error text default null
) returns void language plpgsql security definer set search_path = public as $$
declare _org uuid; _current tse_status;
begin
  select org_id, tse_status into _org, _current from orders where id = _order_id;
  if _org is null then raise exception 'order not found'; end if;
  if not is_org_member(_org) then raise exception 'not a member of this organization'; end if;

  if _current = 'signed' then
    raise exception 'order % already carries a TSE signature', _order_id;
  end if;
  if _status not in ('signed', 'failed') then
    raise exception 'tse status must be signed or failed';
  end if;

  update orders set
    tse_status = _status::tse_status,
    tse_transaction_number = _transaction_number,
    tse_signature_counter = _signature_counter,
    tse_signature = _signature,
    tse_serial_number = _serial_number,
    tse_time_start = _time_start,
    tse_time_end = _time_end,
    tse_timestamp_format = _timestamp_format,
    tse_signature_algorithm = _signature_algorithm,
    tse_public_key = _public_key,
    tse_client_serial = _client_serial,
    tse_qr_data = _qr_data,
    tse_error = _error
  where id = _order_id;
end $$;
