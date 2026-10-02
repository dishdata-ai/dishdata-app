import type { Ionicons } from "@expo/vector-icons";
import { useOrg } from "@/lib/org-context";
import { hasModule } from "@/lib/api/session";

export interface AppScreen {
  /** Route name inside app/(tabs). */
  name: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Web module ids this screen belongs to; a person needs any one of them. See web src/lib/modules.ts. */
  modules: string[];
  blurb: string;
}

/**
 * Every staff screen, in the order they claim a tab (the daily-driver screens first, so Tasks isn't pushed under More). A phone's tab bar holds five (four plus More), so the first few a person has
 * access to get tabs and the rest live under More — the same idea as the website's mobile bottom bar. Access
 * follows the website's per-person switches (Settings → modules, Team & Access), so a screen someone has been
 * switched off from simply isn't offered.
 */
export const SCREENS: AppScreen[] = [
  { name: "index", title: "My Day", icon: "sunny", modules: ["myday"], blurb: "Your shift, tasks and shifts" },
  { name: "pos", title: "POS", icon: "cart", modules: ["pos"], blurb: "Take orders and payments" },
  { name: "kitchen", title: "Kitchen", icon: "flame", modules: ["kitchen", "kitchenops"], blurb: "Tickets, stock and prep" },
  { name: "tasks", title: "Tasks", icon: "checkbox", modules: ["tasks", "dailytasks"], blurb: "To-dos and daily checklists" },
  { name: "floor", title: "Floor", icon: "grid", modules: ["floor"], blurb: "Tables and reservations" },
  { name: "preorders", title: "Preorders", icon: "calendar", modules: ["preorders"], blurb: "Event preorders and seating" },
  { name: "channels", title: "Channels", icon: "storefront", modules: ["channels"], blurb: "Wolt, Uber Eats and Lieferando orders" },
  { name: "delivery", title: "Delivery", icon: "bicycle", modules: ["delivery"], blurb: "Deliveries and riders" },
  { name: "inventory", title: "Inventory", icon: "cube", modules: ["inventory"], blurb: "Stock levels, waste and counts" },
  { name: "loyalty", title: "Loyalty", icon: "gift", modules: ["loyalty"], blurb: "Points and rewards" },
  { name: "hours", title: "My hours", icon: "time", modules: ["timeclock"], blurb: "Your timesheet" },
];

/** Four tabs plus the always-present More tab (which also holds Sign out). */
const MAX_TABS = 4;

/** Which screens this person can use, which get a tab, and which go under More. */
export function useScreens() {
  const { ctx } = useOrg();
  const accessible = SCREENS.filter((s) => s.modules.some((m) => hasModule(ctx, m)));
  // Never leave someone with an empty app.
  const usable = accessible.length > 0 ? accessible : SCREENS.filter((s) => s.name === "index");
  return {
    all: usable,
    bar: usable.slice(0, MAX_TABS),
    more: usable.slice(MAX_TABS),
  };
}
