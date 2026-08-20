import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signTransaction, isFiskalyConfigured } from "./fiskaly";
import { getTseConfig, isTseEnabledForOrg } from "@/lib/tse-config";
import type { Order, Org, OrderLine } from "@/lib/api/database.types";

/** Signing is only attempted when the restaurant is set up AND the server has keys. */
export function isTseActive(org: Pick<Org, "settings">): boolean {
  return isTseEnabledForOrg(org) && isFiskalyConfigured();
}

/**
 * Sign a completed order and record the outcome.
 *
 * Never throws. A TSE outage is a legitimate operating state under KassenSichV
 * — the sale stands, the failure is logged with a reason, and the receipt must
 * show the signature is missing. Throwing here would either lose a completed
 * sale or leave the order in limbo, both worse than an honest 'failed' record.
 *
 * Returns whether the order ended up signed, so the caller can tell the till.
 */
export async function signOrder(
  supabase: SupabaseClient,
  order: Order,
  org: Org,
  payments: { method: string; amount: number }[],
): Promise<{ signed: boolean; error?: string }> {
  const cfg = getTseConfig(org);

  const record = async (fields: Record<string, unknown>) => {
    const { error } = await supabase.rpc("attach_tse_signature", fields);
    if (error) throw new Error(`Could not record the TSE result: ${error.message}`);
  };

  try {
    const items: OrderLine[] = Array.isArray(order.items) ? order.items : [];

    // Amounts come from the stored order, never from the client — the signature
    // has to attest to what was actually recorded, not what a till claimed.
    const lines = items.map((l) => ({
      amount: +(l.price * l.qty).toFixed(2),
      rate: l.tax_rate ?? org.tax_rate,
    }));

    // A discount reduces what was actually taken, so it has to be reflected in
    // the signed amounts. Spread across rates in proportion to each rate's share
    // of gross — the same allocation checkout_order uses for the VAT itself.
    const gross = lines.reduce((s, l) => s + l.amount, 0);
    const discount = order.discount || 0;
    const adjusted =
      discount > 0 && gross > 0
        ? lines.map((l) => ({ ...l, amount: +(l.amount - (discount * l.amount) / gross).toFixed(2) }))
        : lines;

    const result = await signTransaction({
      tssId: cfg.tssId,
      clientId: cfg.clientId,
      txId: order.id, // our order id doubles as fiskaly's idempotency key
      lines: adjusted,
      payments: payments.map((p) => ({
        amount: p.amount,
        type: p.method === "cash" ? ("CASH" as const) : ("NON_CASH" as const),
      })),
    });

    await record({
      _order_id: order.id,
      _status: "signed",
      _transaction_number: result.transactionNumber,
      _signature_counter: result.signatureCounter,
      _signature: result.signature,
      _serial_number: result.serialNumber,
      _time_start: result.timeStart,
      _time_end: result.timeEnd,
      _timestamp_format: result.timestampFormat ?? null,
      _signature_algorithm: result.signatureAlgorithm ?? null,
      _public_key: result.publicKey ?? null,
      _client_serial: result.clientSerial ?? null,
      _qr_data: result.qrData ?? null,
      _error: null,
    });
    return { signed: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown TSE error";
    try {
      await record({
        _order_id: order.id,
        _status: "failed",
        _error: message.slice(0, 500),
      });
    } catch {
      // Recording the failure itself failed. Nothing further to try — the order
      // stays 'not_required', which the unsigned-orders report will surface.
    }
    return { signed: false, error: message };
  }
}
