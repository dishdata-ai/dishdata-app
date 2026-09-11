import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchRecipeId } from "@/lib/channels";
import { type ParsedLine, type ParsedOrder, obj, str, num, arr } from "@/lib/channels/types";
import type { ChannelOrderLine } from "@/lib/api/database.types";

/**
 * SumUp — the till, not a delivery platform.
 *
 * SumUp has no webhook for in-person (terminal / POS app) payments, so sales
 * are PULLED: read the merchant's transaction history since the last sync,
 * fetch each new sale's detail (that is where the product lines live), then
 * push it through the same channel_orders → accept_channel_order path the
 * delivery platforms use. A sale on SumUp therefore depletes stock exactly
 * like one rung up in DishData.
 *
 * Auth: a secret API key (`sup_sk_…`) from SumUp Dashboard → Developer
 * settings → API keys, sent as a bearer token.
 *
 * Money is in MAJOR units (10.50), unlike Wolt/Uber's cents, and `amount`
 * includes the tip. Product `vat_rate` is documented as a fraction (0.19); it
 * is treated as a percentage if it ever comes back above 1.
 *
 * Idempotency: the transaction id is channel_orders.external_id, so the
 * overlap window, a concurrent sync or a retry all land on the unique key.
 *
 * Docs: developer.sumup.com/api/transactions
 */

const API = "https://api.sumup.com";
/** Re-read this far behind the cursor, for sales that settle a little late. */
const OVERLAP_MS = 15 * 60 * 1000;
/** Detail fetches per run — keeps one run inside a serverless timeout. */
const MAX_PER_RUN = 150;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
/** First sync with no start date saved: look back this far. */
const FIRST_SYNC_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Line for money SumUp took without a product (quick-amount sales). */
export const CUSTOM_AMOUNT = "Custom amount";

/** Columns a sync needs. Includes `credentials` — service-role only. */
export const SUMUP_CHANNEL_COLUMNS =
  "id, org_id, external_store_id, webhook_secret, is_active, credentials, settings";

export interface SumUpChannel {
  id: string;
  org_id: string;
  external_store_id: string;
  webhook_secret: string;
  is_active: boolean;
  credentials: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface SyncResult {
  imported: number;
  /** Lines that matched no recipe — they rang up but moved no stock. */
  unmapped: number;
  failed: number;
  /** More sales are waiting than one run takes; the next run continues. */
  more: boolean;
  syncedUntil: string;
}

interface TxSummary {
  id: string;
  status: string;
  type: string;
  timestamp: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function time(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

async function sumupGet(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`SumUp rejected the API key (${res.status}) — check it can read transactions.`);
  }
  if (!res.ok) {
    throw new Error(`SumUp ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

/** Transaction history from `since`, oldest first, following `next` links. */
async function listSince(
  apiKey: string,
  merchant: string,
  since: Date,
): Promise<{ txs: TxSummary[]; truncated: boolean }> {
  const base = `/v2.1/merchants/${encodeURIComponent(merchant)}/transactions/history`;
  let query = new URLSearchParams({
    order: "ascending",
    limit: String(PAGE_SIZE),
    oldest_time: since.toISOString(),
  }).toString();

  const txs: TxSummary[] = [];
  for (let page = 0; query; page++) {
    if (page === MAX_PAGES) return { txs, truncated: true };
    const body = obj(await sumupGet(`${base}?${query}`, apiKey));
    for (const raw of arr(body.items)) {
      const t = obj(raw);
      txs.push({
        id: str(t.id),
        status: str(t.status).toUpperCase(),
        type: str(t.type, "PAYMENT").toUpperCase(),
        timestamp: str(t.timestamp),
      });
    }
    // `href` is a bare query string, e.g. "limit=100&oldest_ref=…&order=ascending".
    const next = arr(body.links).map(obj).find((l) => str(l.rel) === "next");
    query = next ? str(next.href).replace(/^[^?]*\?/, "") : "";
  }
  return { txs, truncated: false };
}

/** Normalize one SumUp transaction (its detail, which carries the products). */
export function parseSumUpTransaction(
  tx: unknown,
  merchant: string,
): ParsedOrder & { occurredAt: string } {
  const t = obj(tx);
  const id = str(t.id);
  if (!id) throw new Error("SumUp transaction has no id.");

  const tip = round2(num(t.tip_amount));
  const charged = round2(num(t.amount) - tip);

  const lines: ParsedLine[] = arr(t.products).map((raw) => {
    const p = obj(raw);
    const qty = num(p.quantity, 1) || 1;
    const rate = p.vat_rate === undefined || p.vat_rate === null ? null : num(p.vat_rate);
    const unit =
      p.price_with_vat !== undefined ? num(p.price_with_vat)
      : p.total_with_vat !== undefined ? num(p.total_with_vat) / qty
      : num(p.price);
    return {
      name: str(p.name).trim() || "Item",
      qty,
      price: round2(unit),
      taxRate: rate === null ? null : rate <= 1 ? round2(rate * 100) : rate,
      notes: null,
    };
  });

  // Quick-amount sales carry no products, and products can cover only part of
  // a charge. Ring up the remainder so revenue matches what SumUp took — it
  // cannot move stock, and the UI flags it as unmapped.
  const listed = lines.reduce((s, l) => s + l.price * l.qty, 0);
  if (charged - listed > 0.009) {
    lines.push({ name: CUSTOM_AMOUNT, qty: 1, price: round2(charged - listed), notes: null });
  }

  const code = str(t.transaction_code);
  return {
    externalId: id,
    displayId: code || id.slice(-6),
    storeId: merchant,
    customerName: "",
    // SumUp does not record eat-in vs take-away.
    orderType: "dine_in",
    lines,
    gross: charged,
    notes: null,
    fulfillment: {
      payment_type: str(t.payment_type).toUpperCase(),
      entry_mode: str(t.entry_mode) || null,
      tip,
      currency: str(t.currency) || null,
      transaction_code: code || null,
    },
    occurredAt: str(t.timestamp) || new Date().toISOString(),
  };
}

/** Surface a sync failure on the channel card. */
export async function recordSyncError(
  admin: SupabaseClient,
  channelId: string,
  message: string,
): Promise<void> {
  await admin
    .from("channels")
    .update({ last_error: message, last_error_at: new Date().toISOString() })
    .eq("id", channelId);
}

/**
 * Import every SumUp sale since the channel's cursor. Throws when SumUp
 * cannot be reached at all; per-sale failures are counted and retried on the
 * next run.
 */
export async function syncSumUpChannel(
  admin: SupabaseClient,
  channel: SumUpChannel,
): Promise<SyncResult> {
  const apiKey = str(obj(channel.credentials).api_key).trim();
  if (!apiKey) throw new Error("No SumUp API key saved — add one in the SumUp settings.");
  const merchant = channel.external_store_id.trim();
  if (!merchant) throw new Error("No SumUp merchant code saved on the channel.");

  const startedAt = new Date();
  const settings = obj(channel.settings);
  const syncedUntil = time(str(settings.synced_until));
  const syncFrom = time(str(settings.sync_from));
  const since = Number.isFinite(syncedUntil)
    ? new Date(syncedUntil - OVERLAP_MS)
    : new Date(Number.isFinite(syncFrom) ? syncFrom : startedAt.getTime() - FIRST_SYNC_LOOKBACK_MS);

  const { txs, truncated } = await listSince(apiKey, merchant, since);

  // Completed sales only: a cancelled or failed payment took no money, and a
  // sale refunded before it synced has status REFUNDED. Refunds of an already
  // imported sale are separate REFUND transactions — not imported yet.
  const sales = txs.filter((t) => t.id && t.status === "SUCCESSFUL" && t.type === "PAYMENT");

  const seen = new Set<string>();
  for (let i = 0; i < sales.length; i += 100) {
    const { data, error } = await admin
      .from("channel_orders")
      .select("external_id")
      .eq("org_id", channel.org_id)
      .eq("provider", "sumup")
      .in("external_id", sales.slice(i, i + 100).map((t) => t.id));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) seen.add(r.external_id as string);
  }
  const fresh = sales.filter((t) => !seen.has(t.id));
  const batch = fresh.slice(0, MAX_PER_RUN);

  const { data: recipes } = await admin
    .from("recipes")
    .select("id, name")
    .eq("org_id", channel.org_id)
    .eq("is_active", true);

  let imported = 0;
  let unmapped = 0;
  let failed = 0;
  let lastError: string | null = null;
  let firstFailedAt = NaN;

  for (const summary of batch) {
    try {
      const detail = obj(await sumupGet(
        `/v2.1/merchants/${encodeURIComponent(merchant)}/transactions?id=${encodeURIComponent(summary.id)}`,
        apiKey,
      ));
      const parsed = parseSumUpTransaction({ ...summary, ...detail }, merchant);

      const items: ChannelOrderLine[] = parsed.lines.map((l) => ({
        name: l.name,
        qty: l.qty,
        price: l.price,
        recipe_id: l.name === CUSTOM_AMOUNT ? null : matchRecipeId(l.name, recipes ?? []),
        notes: l.notes ?? null,
        tax_rate: l.taxRate ?? null,
      }));

      const { data: row, error: insErr } = await admin
        .from("channel_orders")
        .insert({
          org_id: channel.org_id,
          channel_id: channel.id,
          provider: "sumup",
          external_id: parsed.externalId,
          external_display_id: parsed.displayId,
          status: "pending",
          items,
          gross: parsed.gross,
          customer_name: parsed.customerName,
          order_type: parsed.orderType,
          notes: parsed.notes,
          fulfillment: parsed.fulfillment,
          raw: detail,
          // When it sold, not when we synced — accept_channel_order dates the
          // order and payment from this.
          received_at: parsed.occurredAt,
        })
        .select("id")
        .single();
      if (insErr) {
        if (insErr.code === "23505") continue; // a concurrent sync got it first
        throw new Error(insErr.message);
      }

      // A till sale has already happened — there is nothing to decide, so it
      // is always booked straight away.
      const { error: accErr } = await admin.rpc("accept_channel_order", {
        _channel_order: row.id,
        _secret: channel.webhook_secret,
      });
      if (accErr) {
        // Stays pending in the inbox, where staff can still accept it.
        failed++;
        lastError = `SumUp sale ${parsed.displayId} imported but not booked: ${accErr.message}`;
        continue;
      }
      imported++;
      unmapped += items.filter((l) => !l.recipe_id).length;
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : "SumUp sync failed.";
      const at = time(summary.timestamp);
      if (Number.isFinite(at) && !(at >= firstFailedAt)) firstFailedAt = at;
    }
  }

  // Advance the cursor only past what was fully handled: stop at the last
  // processed sale when capped, and never move beyond a sale that failed to
  // import, so the next run retries it.
  let cursor = startedAt.getTime();
  if (fresh.length > batch.length) cursor = time(batch[batch.length - 1].timestamp);
  else if (truncated && txs.length) cursor = time(txs[txs.length - 1].timestamp);
  if (Number.isFinite(firstFailedAt) && firstFailedAt < cursor) cursor = firstFailedAt;
  if (!Number.isFinite(cursor)) cursor = since.getTime() + OVERLAP_MS;
  const until = new Date(cursor).toISOString();

  await admin
    .from("channels")
    .update({
      settings: { ...settings, synced_until: until, last_synced_at: startedAt.toISOString() },
      last_error: lastError,
      ...(lastError ? { last_error_at: new Date().toISOString() } : {}),
    })
    .eq("id", channel.id);

  return {
    imported,
    unmapped,
    failed,
    more: truncated || fresh.length > batch.length,
    syncedUntil: until,
  };
}
