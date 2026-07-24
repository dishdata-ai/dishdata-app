import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { EventMenu, EventMenuItem } from "@/lib/api/database.types";

const dMenus = demoTable<EventMenu>("event_menus");
const dItems = demoTable<EventMenuItem>("event_menu_items");

/** An event menu plus the ids of the recipes it contains. */
export interface EventMenuWithItems extends EventMenu {
  recipe_ids: string[];
}

export async function listEventMenus(orgId: string): Promise<EventMenuWithItems[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const items = dItems.list({ org_id: orgId } as Partial<EventMenuItem>);
    return dMenus
      .list({ org_id: orgId } as Partial<EventMenu>)
      .map((m) => ({
        ...m,
        recipe_ids: items.filter((i) => i.event_menu_id === m.id).map((i) => i.recipe_id),
      }));
  }
  const { data, error } = await getSupabase()
    .from("event_menus")
    .select("*, event_menu_items(recipe_id)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((m) => {
    const { event_menu_items, ...rest } = m as EventMenu & {
      event_menu_items: { recipe_id: string }[];
    };
    return { ...rest, recipe_ids: (event_menu_items ?? []).map((i) => i.recipe_id) };
  });
}

export async function createEventMenu(
  orgId: string,
  name: string,
  recipeIds: string[],
  showOnWebsite = false,
  skipKitchen = false,
): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const menu = {
      id: uid(),
      org_id: orgId,
      name,
      is_active: true,
      show_on_website: showOnWebsite,
      skip_kitchen: skipKitchen,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
    } as EventMenu;
    dMenus.insert(menu);
    for (const rid of recipeIds) {
      dItems.insert({
        id: uid(),
        org_id: orgId,
        event_menu_id: menu.id,
        recipe_id: rid,
        created_at: new Date().toISOString(),
      } as EventMenuItem);
    }
    return menu.id;
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from("event_menus")
    .insert({ org_id: orgId, name, show_on_website: showOnWebsite, skip_kitchen: skipKitchen })
    .select("id")
    .single();
  if (error) throw error;
  const menuId = data.id as string;
  if (recipeIds.length) {
    const { error: itemsError } = await sb
      .from("event_menu_items")
      .insert(recipeIds.map((rid) => ({ org_id: orgId, event_menu_id: menuId, recipe_id: rid })));
    if (itemsError) throw itemsError;
  }
  return menuId;
}

export interface EventMenuPatch {
  name?: string;
  is_active?: boolean;
  show_on_website?: boolean;
  skip_kitchen?: boolean;
  /** When provided, replaces the menu's item set entirely. */
  recipeIds?: string[];
}

export async function updateEventMenu(
  orgId: string,
  id: string,
  patch: EventMenuPatch,
): Promise<void> {
  const { recipeIds, ...fields } = patch;

  if (!isSupabaseConfigured) {
    await demoDelay();
    if (Object.keys(fields).length) dMenus.update(id, fields);
    if (recipeIds) {
      for (const i of dItems.list({ event_menu_id: id } as Partial<EventMenuItem>)) {
        dItems.remove(i.id);
      }
      for (const rid of recipeIds) {
        dItems.insert({
          id: uid(),
          org_id: orgId,
          event_menu_id: id,
          recipe_id: rid,
          created_at: new Date().toISOString(),
        } as EventMenuItem);
      }
    }
    return;
  }

  const sb = getSupabase();
  if (Object.keys(fields).length) {
    const { error } = await sb.from("event_menus").update(fields).eq("id", id).eq("org_id", orgId);
    if (error) throw error;
  }
  if (recipeIds) {
    // Replace the item set: clear then re-insert (the unique constraint on
    // (event_menu_id, recipe_id) makes partial upserts fiddlier than a swap).
    const { error: delError } = await sb.from("event_menu_items").delete().eq("event_menu_id", id);
    if (delError) throw delError;
    if (recipeIds.length) {
      const { error: insError } = await sb
        .from("event_menu_items")
        .insert(recipeIds.map((rid) => ({ org_id: orgId, event_menu_id: id, recipe_id: rid })));
      if (insError) throw insError;
    }
  }
}

export async function deleteEventMenu(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    for (const i of dItems.list({ event_menu_id: id } as Partial<EventMenuItem>)) {
      dItems.remove(i.id);
    }
    dMenus.remove(id);
    return;
  }
  // event_menu_items cascade-delete via the FK.
  const { error } = await getSupabase()
    .from("event_menus")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}
