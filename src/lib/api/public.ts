// Anonymous storefront API — public menu, QR ordering, reservations.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoNotification } from "@/lib/api/notifications";
import type { Org, Recipe, Order, Reservation } from "@/lib/api/database.types";

export interface PublicMenu {
  org: Pick<Org, "id" | "name" | "slug" | "logo_url" | "accent_color" | "currency" | "tax_rate">;
  recipes: Recipe[];
}

const dOrgs = demoTable<Org>("orgs");
const dRecipes = demoTable<Recipe>("recipes");
const dOrders = demoTable<Order>("orders");
const dReservations = demoTable<Reservation>("reservations");

export async function fetchPublicMenu(slug: string): Promise<PublicMenu | null> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) return null;
    return {
      org,
      recipes: dRecipes.list({ org_id: org.id, is_active: true } as Partial<Recipe>),
    };
  }
  const sb = getSupabase();
  const { data: org, error } = await sb
    .from("orgs")
    .select("id, name, slug, logo_url, accent_color, currency, tax_rate")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!org) return null;
  const { data: recipes } = await sb
    .from("recipes")
    .select("*")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .order("category");
  return { org: org as PublicMenu["org"], recipes: (recipes as Recipe[]) ?? [] };
}

export async function placePublicOrder(
  slug: string,
  items: { recipe_id: string; qty: number }[],
  guestName: string,
  tableName: string | null,
  notes: string | null,
  opts?: { email?: string | null; code?: string | null },
): Promise<{ order_number: string; total: number; discount?: number; order_id: string }> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("Restaurant not found");
    const recipes = dRecipes.list({ org_id: org.id } as Partial<Recipe>);
    const lines = items.map((it) => {
      const r = recipes.find((x) => x.id === it.recipe_id && x.is_active);
      if (!r) throw new Error("Item unavailable");
      return { recipe_id: r.id, name: r.name, qty: it.qty, price: r.price };
    });
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const tax = +(subtotal * (org.tax_rate / 100)).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);
    const orderId = uid();
    const orderNumber = `ORD-${String(dOrders.list({ org_id: org.id } as Partial<Order>).length + 1).padStart(4, "0")}`;
    dOrders.insert({
      id: orderId, org_id: org.id, order_number: orderNumber, order_type: "dine_in",
      table_id: null, customer_id: null, guest_name: guestName, items: lines,
      subtotal, tax, tip: 0, total, status: "open", kitchen_status: "new",
      kitchen_notes: [tableName ? `Table: ${tableName}` : null, notes].filter(Boolean).join(". ") || null,
      source: "storefront", created_at: new Date().toISOString(),
    });
    pushDemoNotification(
      org.id, "public_order", `Online order ${orderNumber}`,
      `${guestName}${tableName ? ` at table ${tableName}` : ""} — pay at counter`, "kitchen",
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
