// Client-safe channel constants. Deliberately free of any Node import so
// browser bundles can use it — the adapters in ./index.ts pull in node:crypto
// for signature verification and must stay server-only.

import type { ChannelProvider } from "@/lib/api/database.types";

/** Listed in priority order: Wolt and Uber Eats first. */
export const PROVIDERS: ChannelProvider[] = ["wolt", "ubereats", "lieferando"];

export const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
};

/** What each platform calls the location id you paste into the connect form. */
export const PROVIDER_STORE_LABEL: Record<ChannelProvider, string> = {
  wolt: "Venue ID",
  ubereats: "Store ID",
  lieferando: "Restaurant ID",
};

export function isChannelProvider(v: string): v is ChannelProvider {
  return v === "wolt" || v === "ubereats" || v === "lieferando";
}
