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

  const { data: recipes } = await sb
    .from("recipes")
    .select("*")
    .eq("org_id", org.id)
    .eq("is_active", true)
    .not("name", "ilike", "%(Tournament)%")
    .order("category");

  return { org: org as PublicMenu["org"], recipes: (recipes as Recipe[]) ?? [] };
}
