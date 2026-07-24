import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { EventMenu } from "@/lib/types";

/** An event/popup menu plus the ids of the recipes it contains. */
export interface EventMenuWithItems extends EventMenu {
  recipe_ids: string[];
}

/**
 * Active event menus for the org. The POS shows these as a "Full menu / <event>"
 * switcher so staff can restrict the grid to an event's dishes.
 * Read-only on mobile — menus are created/edited in the web app.
 */
export async function listEventMenus(orgId: string): Promise<EventMenuWithItems[]> {
  // Demo mode has no event menus seeded — the POS just shows the full menu.
  if (!isSupabaseConfigured) return [];

  const { data, error } = await getSupabase()
    .from("event_menus")
    .select("*, event_menu_items(recipe_id)")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((m) => {
    const { event_menu_items, ...rest } = m as EventMenu & {
      event_menu_items: { recipe_id: string }[];
    };
    return { ...rest, recipe_ids: (event_menu_items ?? []).map((i) => i.recipe_id) };
  });
}
