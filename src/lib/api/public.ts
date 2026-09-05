// Anonymous storefront API — public menu, QR ordering, reservations.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoNotification } from "@/lib/api/notifications";
import type { Org, Recipe, Order, Reservation, EventMenu, EventMenuItem } from "@/lib/api/database.types";
import { isSoldOut } from "@/lib/calc";
import { computeTaxGroups, sumTax } from "@/lib/tax";

export interface PublicMenu {
  org: Pick<Org, "id" | "name" | "slug" | "logo_url" | "accent_color" | "currency" | "tax_rate"> & {
    /**
     * The restaurant's own category order (see category-order.ts), lifted
     * out of `org.settings` deliberately — `settings` also carries things
     * like TSE credentials that must never reach an anonymous request, so
     * this is the one field of it ever forwarded to the public menu.
     */
    category_order: string[] | null;
  };
  recipes: Recipe[];
}

/** Pulls only category_order out of a settings blob — never forward the rest to the public API. */
export function publicCategoryOrder(settings: unknown): string[] | null {
  const order = (settings as { categoryOrder?: unknown } | null)?.categoryOrder;
  return Array.isArray(order) ? order.filter((c): c is string => typeof c === "string") : null;
}

/** Tournament-priced items are for in-restaurant/event sale via POS only — never on the public QR/online menu. */
export const isTournamentItem = (r: Pick<Recipe, "name">) => /\(tournament\)/i.test(r.name);

const dOrgs = demoTable<Org>("orgs");
const dRecipes = demoTable<Recipe>("recipes");
const dOrders = demoTable<Order>("orders");
const dReservations = demoTable<Reservation>("reservations");
const dEventMenus = demoTable<EventMenu>("event_menus");
const dEventMenuItems = demoTable<EventMenuItem>("event_menu_items");

/**
 * Recipes belonging to ANY event menu (e.g. a tournament) are POS/event-only —
 * naming them "(Tournament)" is a convention, not a guarantee, so membership
 * in event_menu_items is the real signal. The one exception: an event menu
 * explicitly marked show_on_website replaces the catalog with just its items.
 */
async function eventMenuRecipeIds(orgId: string): Promise<Set<string>> {
  if (!isSupabaseConfigured) {
    return new Set(dEventMenuItems.list({ org_id: orgId } as Partial<EventMenuItem>).map((i) => i.recipe_id));
  }
  const { data } = await getSupabase().from("event_menu_items").select("recipe_id").eq("org_id", orgId);
  return new Set((data ?? []).map((r) => r.recipe_id as string));
}

export async function fetchPublicMenu(slug: string): Promise<PublicMenu | null> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const orgRow = dOrgs.list().find((o) => o.slug === slug);
    if (!orgRow) return null;
    const { settings, ...orgPublicFields } = orgRow;
    const org: PublicMenu["org"] = { ...orgPublicFields, category_order: publicCategoryOrder(settings) };

    const websiteMenu = dEventMenus
      .list({ org_id: org.id, is_active: true, show_on_website: true } as Partial<EventMenu>)[0];
    if (websiteMenu) {
      const ids = new Set(
        dEventMenuItems.list({ event_menu_id: websiteMenu.id } as Partial<EventMenuItem>).map((i) => i.recipe_id),
      );
      return {
        org,
        recipes: dRecipes
          .list({ org_id: org.id, is_active: true } as Partial<Recipe>)
          .filter((r) => ids.has(r.id)),
      };
    }

    const eventIds = await eventMenuRecipeIds(org.id);
    return {
      org,
      recipes: dRecipes
        .list({ org_id: org.id, is_active: true } as Partial<Recipe>)
        .filter((r) => !isTournamentItem(r) && !eventIds.has(r.id)),
    };
  }
  const sb = getSupabase();
  const { data: orgRow, error } = await sb
    .from("orgs")
    .select("id, name, slug, logo_url, accent_color, currency, tax_rate, settings")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!orgRow) return null;
  const { settings, ...orgPublicFields } = orgRow;
  const org: PublicMenu["org"] = { ...orgPublicFields, category_order: publicCategoryOrder(settings) };

  // An event menu explicitly shown on the website replaces the catalog with
  // just its own items (e.g. a tournament-only ordering page).
  const { data: websiteMenu } = await sb
    .from("event_menus")
    .select("id")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .eq("show_on_website", true)
    .maybeSingle();

  if (websiteMenu) {
    const { data: items } = await sb
      .from("event_menu_items")
      .select("recipes!inner(*)")
      .eq("event_menu_id", websiteMenu.id)
      .eq("recipes.is_active", true);
    return {
      org,
      recipes: (items ?? []).map((i) => i.recipes) as unknown as Recipe[],
    };
  }

  // Default: full catalog, minus anything that belongs to an event menu
  // (tournament/event-only) and minus the legacy "(Tournament)"-named items
  // as defense in depth.
  const eventIds = await eventMenuRecipeIds(org.id);
  let query = sb
    .from("recipes")
    .select("*")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .not("name", "ilike", "%(Tournament)%");
  if (eventIds.size) query = query.not("id", "in", `(${[...eventIds].join(",")})`);
  const { data: recipes } = await query.order("category");
  return { org, recipes: (recipes as Recipe[]) ?? [] };
}

export async function placePublicOrder(
  slug: string,
  items: { recipe_id: string; qty: number }[],
  guestName: string,
  tableName: string | null,
  notes: string | null,
  opts?: { email?: string | null; code?: string | null; orderType?: "dine_in" | "takeaway" },
): Promise<{ order_number: string; total: number; discount?: number; order_id: string }> {
  const orderType = opts?.orderType ?? "dine_in";
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("Restaurant not found");
    const recipes = dRecipes.list({ org_id: org.id } as Partial<Recipe>);
    // Event-menu items are POS/event-only, except when their menu is the one
    // currently swapped in for the website (see fetchPublicMenu).
    const websiteMenu = dEventMenus
      .list({ org_id: org.id, is_active: true, show_on_website: true } as Partial<EventMenu>)[0];
    const allowedEventIds = websiteMenu
      ? new Set(
          dEventMenuItems.list({ event_menu_id: websiteMenu.id } as Partial<EventMenuItem>).map((i) => i.recipe_id),
        )
      : null;
    const eventIds = await eventMenuRecipeIds(org.id);
    const lines = items.map((it) => {
      const r = recipes.find((x) => x.id === it.recipe_id && x.is_active);
      const eventBlocked = eventIds.has(it.recipe_id) && !allowedEventIds?.has(it.recipe_id);
      if (!r || isSoldOut(r) || isTournamentItem(r) || eventBlocked) throw new Error("Item unavailable");
      return {
        recipe_id: r.id, name: r.name, qty: it.qty, price: r.price,
        ...(r.tax_rate == null ? {} : { tax_rate: r.tax_rate }),
      };
    });
    // VAT-included pricing, per-rate (food vs drinks) — mirrors place_public_order in 0032.
    const gross = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const tax = sumTax(computeTaxGroups(lines, org.tax_rate, 0));
    const total = +gross.toFixed(2);
    const subtotal = +(gross - tax).toFixed(2);
    const orderId = uid();
    const orderNumber = `ORD-${String(dOrders.list({ org_id: org.id } as Partial<Order>).length + 1).padStart(4, "0")}`;
    dOrders.insert({
      id: orderId, org_id: org.id, order_number: orderNumber, order_type: orderType,
      table_id: null, customer_id: null, guest_name: guestName, items: lines,
      subtotal, tax, tip: 0, total, discount: 0, status: "open", kitchen_status: "new",
      kitchen_notes: [tableName ? `Table: ${tableName}` : null, notes].filter(Boolean).join(". ") || null,
      source: "storefront", created_at: new Date().toISOString(),
    });
    pushDemoNotification(
      org.id, "public_order", `Online order ${orderNumber}`,
      orderType === "takeaway"
        ? `${guestName} — takeaway, pay at counter`
        : `${guestName}${tableName ? ` at table ${tableName}` : ""} — pay at counter`,
      "kitchen",
    );
    return { order_number: orderNumber, total, order_id: orderId };
  }
  const { data, error } = await getSupabase().rpc("place_public_order", {
    _slug: slug,
    _items: items,
    _guest_name: guestName,
    _table_name: tableName,
    _notes: notes,
    _email: opts?.email ?? null,
    _code: opts?.code ?? null,
    _order_type: orderType,
  });
  if (error) throw error;
  return data as { order_number: string; total: number; discount?: number; order_id: string };
}

export async function placePublicReservation(
  slug: string,
  guestName: string,
  phone: string,
  partySize: number,
  startsAt: string,
  note: string | null,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("Restaurant not found");
    dReservations.insert({
      id: uid(), org_id: org.id, table_id: null, customer_id: null,
      guest_name: guestName, phone, party_size: partySize, starts_at: startsAt,
      duration_min: 90, status: "booked", note, source: "public",
    });
    pushDemoNotification(
      org.id, "reservation", `New reservation: ${guestName}`,
      `${partySize} guests on ${new Date(startsAt).toLocaleString()}`, "floor",
    );
    return;
  }
  const { error } = await getSupabase().rpc("place_public_reservation", {
    _slug: slug,
    _guest_name: guestName,
    _phone: phone,
    _party_size: partySize,
    _starts_at: startsAt,
    _note: note,
  });
  if (error) throw error;
}
