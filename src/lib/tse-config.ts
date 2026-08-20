import type { Org } from "@/lib/api/database.types";

/**
 * Per-restaurant TSE settings, stored on `org.settings.tse`.
 *
 * Deliberately free of secrets and server-only imports so the POS can read it
 * too: the fiskaly API credentials are DishData's and stay in server env vars,
 * while what varies per restaurant is only which TSS and till these sales are
 * signed against. Being per-org is also what lets TSE be switched on for one
 * restaurant while another keeps running untouched.
 */
export interface TseConfig {
  enabled: boolean;
  /** fiskaly TSS id — one per restaurant. */
  tssId: string;
  /** fiskaly Client id — one per till. */
  clientId: string;
}

export const DEFAULT_TSE: TseConfig = { enabled: false, tssId: "", clientId: "" };

export function getTseConfig(org: Pick<Org, "settings"> | null | undefined): TseConfig {
  const raw = (org?.settings as Record<string, unknown> | undefined)?.tse;
  if (!raw || typeof raw !== "object") return DEFAULT_TSE;
  const t = raw as Partial<TseConfig>;
  return {
    enabled: !!t.enabled,
    tssId: typeof t.tssId === "string" ? t.tssId : "",
    clientId: typeof t.clientId === "string" ? t.clientId : "",
  };
}

/**
 * Whether this restaurant's sales should be routed through the signing
 * endpoint. The server re-checks its own configuration before signing, so this
 * only chooses the code path — it is not the authority on whether a sale is
 * signed.
 */
export function isTseEnabledForOrg(org: Pick<Org, "settings"> | null | undefined): boolean {
  const c = getTseConfig(org);
  return c.enabled && !!c.tssId && !!c.clientId;
}
