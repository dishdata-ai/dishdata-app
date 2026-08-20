import "server-only";

/**
 * fiskaly SIGN DE — cloud TSE for the German KassenSichV (§146a AO).
 *
 * Every sale on a till with a cash function must be signed by a BSI-certified
 * TSE, and the signature must reach the customer's receipt. fiskaly runs the
 * certified hardware; we call their API and store what comes back.
 *
 * Server-only by construction: the API secret must never reach a browser, and
 * the signature has to be obtained somewhere the client can't tamper with the
 * amounts being signed.
 *
 * Structure: an account holds TSSs (one per restaurant), a TSS holds Clients
 * (one per till). Transactions are signed against a TSS by a Client.
 */

const BASE = process.env.FISKALY_API_URL || "https://kassensichv.fiskaly.com/api/v2";

export function isFiskalyConfigured(): boolean {
  return Boolean(process.env.FISKALY_API_KEY && process.env.FISKALY_API_SECRET);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Bearer token for the fiskaly API, cached until shortly before it expires.
 * Minting one per sale would add a round-trip to every checkout and burn
 * through rate limits during a lunch rush.
 */
async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.FISKALY_API_KEY,
      api_secret: process.env.FISKALY_API_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`fiskaly auth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { access_token: string; access_token_expires_in?: number };
  if (!body.access_token) throw new Error("fiskaly auth returned no access_token");

  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.access_token_expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const token = await getToken();
  // A hung TSE call must not hold a checkout open indefinitely — the outage
  // path is a legitimate outcome and needs to be reached promptly.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`fiskaly ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** VAT buckets fiskaly expects. German food is REDUCED (7%), drinks NORMAL (19%). */
export type FiskalyVatRate = "NORMAL" | "REDUCED" | "SPECIAL_RATE_1" | "SPECIAL_RATE_2" | "NULL";

/**
 * Map a percentage to fiskaly's bucket. Anything unrecognised goes to NULL
 * rather than being guessed into a rate — a wrong bucket misstates the VAT on
 * a fiscal record, which is worse than an obviously wrong one.
 */
export function vatBucket(rate: number): FiskalyVatRate {
  if (rate === 19) return "NORMAL";
  if (rate === 7) return "REDUCED";
  if (rate === 10.7) return "SPECIAL_RATE_1";
  if (rate === 5.5) return "SPECIAL_RATE_2";
  if (rate === 0) return "NULL";
  return "NULL";
}

export interface TseLine {
  /** Gross amount for this VAT bucket. */
  amount: number;
  rate: number;
}

export interface TsePayment {
  amount: number;
  /** CASH or NON_CASH — the distinction the tax office cares about most. */
  type: "CASH" | "NON_CASH";
}

export interface TseSignResult {
  transactionNumber: number;
  signatureCounter: number;
  signature: string;
  serialNumber: string;
  timeStart: string;
  timeEnd: string;
  timestampFormat?: string;
  signatureAlgorithm?: string;
  publicKey?: string;
  clientSerial?: string;
  qrData?: string;
}

interface TxResponse {
  number: number;
  time_start: number | string;
  time_end: number | string;
  tss_serial_number: string;
  client_serial_number?: string;
  qr_code_data?: string;
  log?: { timestamp?: number | string; timestamp_format?: string };
  signature?: { value: string; counter: number; algorithm?: string; public_key?: string };
}

/** fiskaly returns unix seconds; the DB wants a timestamptz. */
function toIso(v: number | string | undefined): string {
  if (v === undefined) return new Date().toISOString();
  if (typeof v === "number") return new Date(v * 1000).toISOString();
  return /^\d+$/.test(v) ? new Date(Number(v) * 1000).toISOString() : v;
}

const money = (n: number) => n.toFixed(2);

/**
 * Sign one completed sale: open a transaction and immediately finish it with
 * the receipt data.
 *
 * Two calls, not one, because that is the shape the TSE requires — a signed
 * start and a signed finish bracket the transaction. `tx_revision` must be 1 on
 * the first call and increment on each subsequent one.
 *
 * NOTE ON TIMING: a stricter reading of §146a wants the transaction opened when
 * the order starts (Vorgangsbeginn) rather than at payment. That matters for
 * long-running table service; for pay-immediately sales, opening and finishing
 * at checkout is the standard interpretation. Open tabs should be signed when
 * they are settled, which is where this is called from.
 */
export async function signTransaction(input: {
  tssId: string;
  clientId: string;
  /** Our order id, used as an idempotency key so a retry can't double-sign. */
  txId: string;
  lines: TseLine[];
  payments: TsePayment[];
}): Promise<TseSignResult> {
  const base = { client_id: input.clientId };

  // 1. Open. The TSE signs the start of the process.
  await api<TxResponse>(`/tss/${input.tssId}/tx/${input.txId}?tx_revision=1`, {
    method: "PUT",
    body: JSON.stringify({ ...base, state: "ACTIVE" }),
  });

  // 2. Finish, carrying the amounts. Grouped per VAT rate and per payment type,
  //    which is exactly what DSFinV-K later reports on.
  const byRate = new Map<FiskalyVatRate, number>();
  for (const l of input.lines) {
    const b = vatBucket(l.rate);
    byRate.set(b, +((byRate.get(b) ?? 0) + l.amount).toFixed(2));
  }
  const byPayment = new Map<"CASH" | "NON_CASH", number>();
  for (const p of input.payments) {
    byPayment.set(p.type, +((byPayment.get(p.type) ?? 0) + p.amount).toFixed(2));
  }

  const finished = await api<TxResponse>(`/tss/${input.tssId}/tx/${input.txId}?tx_revision=2`, {
    method: "PUT",
    body: JSON.stringify({
      ...base,
      state: "FINISHED",
      schema: {
        standard_v1: {
          receipt: {
            receipt_type: "RECEIPT",
            amounts_per_vat_rate: [...byRate.entries()].map(([vat_rate, amount]) => ({
              vat_rate,
              amount: money(amount),
            })),
            amounts_per_payment_type: [...byPayment.entries()].map(([payment_type, amount]) => ({
              payment_type,
              amount: money(amount),
              currency: "EUR",
            })),
          },
        },
      },
    }),
  });

  if (!finished.signature?.value) {
    throw new Error("fiskaly finished the transaction without returning a signature");
  }

  return {
    transactionNumber: finished.number,
    signatureCounter: finished.signature.counter,
    signature: finished.signature.value,
    serialNumber: finished.tss_serial_number,
    timeStart: toIso(finished.time_start),
    timeEnd: toIso(finished.time_end),
    timestampFormat: finished.log?.timestamp_format,
    signatureAlgorithm: finished.signature.algorithm,
    publicKey: finished.signature.public_key,
    clientSerial: finished.client_serial_number,
    qrData: finished.qr_code_data,
  };
}
