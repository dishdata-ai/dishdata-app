import type { ChannelProvider } from "@/lib/api/database.types";
import type { ChannelAdapter } from "@/lib/channels/types";
import { wolt } from "@/lib/channels/wolt";
import { ubereats } from "@/lib/channels/ubereats";
import { lieferando } from "@/lib/channels/lieferando";

// Re-exported so server code has one import site; client code must import
// these from ./providers instead (this module loads node:crypto).
export { PROVIDERS, PROVIDER_LABEL, PROVIDER_STORE_LABEL, isChannelProvider } from "@/lib/channels/providers";

/** Registry, in the order the Channels page lists them. */
export const ADAPTERS: Record<ChannelProvider, ChannelAdapter> = {
  wolt,
  ubereats,
  lieferando,
};

export function adapterFor(provider: ChannelProvider): ChannelAdapter {
  return ADAPTERS[provider];
}

/**
 * Resolve a platform line to one of our recipes by name, so accepting the
 * order can deplete stock. Exact case-insensitive match first, then a
 * containment match (platform menus often suffix names, e.g. "Chicken
 * Biriyani (Large)"). Unmatched lines still ring up — they just cannot move
 * inventory, and the UI flags them so the mapping can be fixed.
 */
export function matchRecipeId(
  lineName: string,
  recipes: { id: string; name: string }[],
): string | null {
  const needle = lineName.trim().toLowerCase();
  if (!needle) return null;

  const exact = recipes.find((r) => r.name.trim().toLowerCase() === needle);
  if (exact) return exact.id;

  // Prefer the longest containment match so "Chicken Biriyani" beats "Chicken"
  // when both would match.
  const partial = recipes
    .filter((r) => {
      const n = r.name.trim().toLowerCase();
      return n.length > 2 && (needle.includes(n) || n.includes(needle));
    })
    .sort((a, b) => b.name.length - a.name.length);

  return partial[0]?.id ?? null;
}
