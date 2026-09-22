// Client-safe registry of the external accounts Marketing can connect.
// No Node imports: the Accounts tab renders straight from this.

import type { SocialProvider } from "@/lib/api/database.types";

export type SocialGroup = "Google" | "Meta" | "TikTok";

export interface SocialProviderDef {
  id: SocialProvider;
  label: string;
  group: SocialGroup;
  /** What connecting it unlocks. */
  blurb: string;
  /** Brand-ish dot colour for the card. */
  tone: string;
  /**
   * Flipped to true in the phase that ships the provider. While false the card
   * says "Coming soon" instead of offering a Connect button that would 404.
   */
  implemented: boolean;
}

export const SOCIAL_PROVIDERS: SocialProviderDef[] = [
  { id: "google_business", label: "Google Business Profile", group: "Google", tone: "#4285f4", implemented: false,
    blurb: "Hours, menu and posts on Google Maps & Search, plus reviews you can answer." },
  { id: "instagram", label: "Instagram", group: "Meta", tone: "#e1306c", implemented: false,
    blurb: "Schedule posts, reply to comments and DMs, see reach." },
  { id: "facebook", label: "Facebook Page", group: "Meta", tone: "#1877f2", implemented: false,
    blurb: "Cross-post, and answer Messenger and page comments." },
  { id: "meta_catalog", label: "Instagram & Facebook Shop", group: "Meta", tone: "#0a7cff", implemented: false,
    blurb: "Product catalog for shoppable posts, linking to your online menu." },
  { id: "tiktok", label: "TikTok", group: "TikTok", tone: "#25f4ee", implemented: false,
    blurb: "Publish videos and photo posts, track views." },
  { id: "tiktok_shop", label: "TikTok Shop", group: "TikTok", tone: "#fe2c55", implemented: false,
    blurb: "Sell vouchers and packaged goods; orders land in Sales Channels." },
];

export const SOCIAL_PROVIDER_LABEL = Object.fromEntries(
  SOCIAL_PROVIDERS.map((p) => [p.id, p.label]),
) as Record<SocialProvider, string>;

export const socialProviderById = (id: SocialProvider) => SOCIAL_PROVIDERS.find((p) => p.id === id)!;
