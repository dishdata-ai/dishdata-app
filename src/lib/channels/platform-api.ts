import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelProvider } from "@/lib/api/database.types";

/**
 * Outbound calls to the delivery platforms: OAuth token, order fetch, and the
 * accept/deny acknowledgement.
 *
 * The ack is what makes "accept once, in DishData" true — without it staff
 * would still have to confirm on the platform's own tablet, and on Uber the
 * order auto-cancels after ~11.5 minutes of silence.
 *
 * Tokens are cached back onto the channel row: Uber's last 30 days and its
 * token endpoint is capped at 100 requests/hour, so minting per request would
 * break under real order volume.
 */

export interface PlatformCredentials {
  client_id?: string;
  client_secret?: string;
  /** Cached bearer token. */
  access_token?: string;
  token_expires_at?: string;
}

const CONFIG: Record<ChannelProvider, { tokenUrl: string; scope?: string; apiBase: string }> = {
  ubereats: {
    tokenUrl: "https://auth.uber.com/oauth/v2/token",
    // eats.order = accept/deny + read v1; eats.store.orders.read = read v2.
    scope: "eats.order eats.store.orders.read",
    apiBase: "https://api.uber.com",
  },
  wolt: {
    tokenUrl: "https://authentication.wolt.com/v1/wauth2/access_token",
    apiBase: "https://pos-integration-service.wolt.com",
  },
  lieferando: {
    tokenUrl: "",
    apiBase: "",
  },
};

/** Fetch (or reuse) an access token, caching it on the channel row. */
export async function getToken(
  admin: SupabaseClient,
  provider: ChannelProvider,
  channelId: string,
  creds: PlatformCredentials,
): Promise<string> {
  const fresh =
    creds.access_token &&
    creds.token_expires_at &&
    new Date(creds.token_expires_at).getTime() > Date.now() + 60 * 60 * 1000;
  if (fresh) return creds.access_token!;

  const cfg = CONFIG[provider];
  if (!cfg.tokenUrl) throw new Error(`No token endpoint configured for ${provider}.`);
  if (!creds.client_id || !creds.client_secret) {
    throw new Error(`API credentials are not set for the ${provider} channel.`);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      grant_type: "client_credentials",
      ...(cfg.scope ? { scope: cfg.scope } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${provider} token request failed (${res.status}): ${await res.text()}`);

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error(`${provider} token response carried no access_token.`);

  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  await admin
    .from("channels")
    .update({ credentials: { ...creds, access_token: body.access_token, token_expires_at: expiresAt } })
    .eq("id", channelId);

  return body.access_token;
}

/** GET the full order from the URL the notification pointed at. */
export async function fetchOrder(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Order fetch failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export interface AckInput {
  provider: ChannelProvider;
  externalId: string;
  token: string;
  accept: boolean;
  /** Quoted prep time, used to compute Uber's pickup_time. */
  prepMinutes?: number;
  reason?: string;
  /** Our order number, echoed to the platform for cross-referencing. */
  reference?: string;
}

/** Tell the platform the order was accepted or denied. */
export async function ackOrder(input: AckInput): Promise<void> {
  const { provider, externalId, token, accept } = input;
  const id = encodeURIComponent(externalId);

  if (provider === "ubereats") {
    const path = accept ? "accept_pos_order" : "deny_pos_order";
    const body = accept
      ? {
          reason: input.reason ?? "Accepted in DishData",
          // Uber wants an absolute ready time, not a duration.
          pickup_time: Math.floor(Date.now() / 1000) + (input.prepMinutes ?? 20) * 60,
          ...(input.reference ? { external_reference_id: input.reference } : {}),
        }
      : { reason: { explanation: input.reason ?? "Unable to fulfill", out_of_items: [] } };

    const res = await fetch(`${CONFIG.ubereats.apiBase}/v1/eats/orders/${id}/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // Uber answers 204 No Content on success.
    if (!res.ok) throw new Error(`Uber ${path} failed (${res.status}): ${await res.text()}`);
    return;
  }

  if (provider === "wolt") {
    // Wolt uses PUT verbs on the order resource.
    const path = accept ? "accept" : "reject";
    const res = await fetch(`${CONFIG.wolt.apiBase}/orders/${id}/${path}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(
        accept
          ? { adjusted_pickup_time: undefined, id: externalId }
          : { reason: input.reason ?? "Unable to fulfill" },
      ),
    });
    if (!res.ok) throw new Error(`Wolt ${path} failed (${res.status}): ${await res.text()}`);
    return;
  }

  throw new Error(`No outbound acknowledge implemented for ${provider}.`);
}

/** Wolt-only: tell Wolt the food is ready so the courier is dispatched. */
export async function markWoltReady(externalId: string, token: string): Promise<void> {
  const res = await fetch(
    `${CONFIG.wolt.apiBase}/orders/${encodeURIComponent(externalId)}/ready`,
    { method: "PUT", headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Wolt ready failed (${res.status}): ${await res.text()}`);
}
