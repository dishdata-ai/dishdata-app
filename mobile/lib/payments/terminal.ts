/**
 * Vivid / Adyen payment terminal client — LOCAL integration.
 *
 * Posts an encrypted SaleToPOIRequest directly to the terminal on the venue
 * LAN. Because it is local (not cloud), this must run on a device on the same
 * network as the terminal — i.e. the POS phone, never the Vercel server.
 *
 * ⚠️ TLS: the terminal serves HTTPS on :8443 with a certificate signed by
 * Adyen's root CA, which is not in Android's default trust store. A release
 * build therefore needs a network-security config trusting that CA (see
 * TERMINAL_SETUP.md). Until that is in place calls will fail with an SSL error.
 */

import {
  buildPaymentRequest,
  buildSecuredMessage,
  decrypt,
  newServiceId,
  type SecurityKey,
} from "@/lib/payments/nexo";

export interface TerminalConfig extends SecurityKey {
  /** Fixed LAN address of the terminal (DHCP reservation or static). */
  ip: string;
  /** Terminal id, e.g. "V400m-123456789". */
  poiId: string;
  /** Stable id for this POS device — must differ per phone. */
  saleId: string;
  /** Milliseconds to wait for the guest to tap/insert. Terminals are slow. */
  timeoutMs?: number;
}

export type TerminalResult =
  | { ok: true; serviceId: string; raw: Record<string, unknown> }
  | { ok: false; error: string; serviceId: string; raw?: Record<string, unknown> };

/** Default: card payments can legitimately take a while at the terminal. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Ask the terminal to take a card payment. Resolves once the terminal reports
 * a final result (approved/declined), or rejects on transport/crypto failure.
 */
export async function requestPayment(
  config: TerminalConfig,
  input: { amount: number; currency: string; transactionId: string },
): Promise<TerminalResult> {
  const serviceId = newServiceId();
  const header = { serviceId, saleId: config.saleId, poiId: config.poiId };

  const request = buildPaymentRequest({
    ...header,
    transactionId: input.transactionId,
    amount: input.amount,
    currency: input.currency,
  });
  const secured = buildSecuredMessage(request, config, header);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`https://${config.ip}:8443/nexo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secured),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    // The most common first-run failure is the untrusted Adyen CA — say so
    // rather than surfacing a bare "Network request failed".
    return {
      ok: false,
      serviceId,
      error: /ssl|certificate|trust/i.test(msg)
        ? `Terminal TLS not trusted (${msg}). The app build must trust Adyen's root CA.`
        : `Could not reach the terminal at ${config.ip}: ${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return { ok: false, serviceId, error: `Terminal returned HTTP ${res.status}` };
  }

  const body = (await res.json()) as {
    SaleToPOISecuredMessage?: {
      NexoBlob: string;
      SecurityTrailer: { Nonce: string; Hmac: string; [k: string]: unknown };
    };
  };

  const envelope = body.SaleToPOISecuredMessage;
  if (!envelope?.NexoBlob) {
    return { ok: false, serviceId, error: "Terminal reply was not a secured Nexo message" };
  }

  let plaintext: string;
  try {
    plaintext = decrypt(
      {
        nexoBlob: envelope.NexoBlob,
        securityTrailer: envelope.SecurityTrailer as never,
      },
      config,
    );
  } catch (e) {
    return {
      ok: false,
      serviceId,
      error: e instanceof Error ? e.message : "Could not decrypt the terminal reply",
    };
  }

  const parsed = JSON.parse(plaintext) as {
    SaleToPOIResponse?: {
      PaymentResponse?: {
        Response?: { Result?: string; ErrorCondition?: string; AdditionalResponse?: string };
      };
    };
  };

  const response = parsed.SaleToPOIResponse?.PaymentResponse?.Response;
  if (response?.Result === "Success") {
    return { ok: true, serviceId, raw: parsed as Record<string, unknown> };
  }
  return {
    ok: false,
    serviceId,
    error: response?.ErrorCondition || response?.Result || "Payment was not approved",
    raw: parsed as Record<string, unknown>,
  };
}
