import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { PublicMenu } from "@/lib/api/public";
import type { Recipe } from "@/lib/api/database.types";

/**
 * Server-side public menu fetch for SSR/SEO on /r/[slug]. Anonymous read.
 * Returns null in demo mode (no Supabase) — the client falls back to demo data.
 */
export async function fetchPublicMenuServer(slug: string): Promise<PublicMenu | null> {
  const sb = await createSupabaseServerClient();
  if (!sb) return null;

  const { data: org } = await sb
    .from("orgs")
    .select("id, name, slug, logo_url, accent_color, currency, tax_rate")
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return null;

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
      org: org as PublicMenu["org"],
      recipes: (items ?? []).map((i) => i.recipes) as unknown as Recipe[],
    };
  }

  // Default: full catalog, minus anything that belongs to an event menu
  // (tournament/event-only) — membership in event_menu_items is the real
  // signal, "(Tournament)" naming is just defense in depth on top of it.
  const { data: eventRows } = await sb.from("event_menu_items").select("recipe_id").eq("org_id", org.id);
  const eventIds = [...new Set((eventRows ?? []).map((r) => r.recipe_id as string))];

  let query = sb
    .from("recipes")
    .select("*")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .not("name", "ilike", "%(Tournament)%");
  if (eventIds.length) query = query.not("id", "in", `(${eventIds.join(",")})`);
  const { data: recipes } = await query.order("category");

  return { org: org as PublicMenu["org"], recipes: (recipes as Recipe[]) ?? [] };
}
