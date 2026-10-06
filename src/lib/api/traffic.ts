import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoDelay } from "@/lib/api/demoDb";

export interface Ranked {
  label: string;
  n: number;
}

export interface SiteStats {
  days: number;
  totals: Record<string, number>;
  /** Distinct visits that reached each step. */
  funnel: Record<string, number>;
  revenue: number;
  daily: { day: string; visits: number; orders: number }[];
  top_pages: Ranked[];
  top_dishes: Ranked[];
  tables: Ranked[];
  devices: Ranked[];
  sources: Ranked[];
  partners: Ranked[];
  order_types: Ranked[];
}

const EMPTY = (days: number): SiteStats => ({
  days, totals: {}, funnel: {}, revenue: 0, daily: [], top_pages: [], top_dishes: [], tables: [], devices: [], sources: [], partners: [], order_types: [],
});

/** Anonymous website traffic for the restaurant's own site (migration 0081). Staff only. */
export async function getSiteStats(slug: string, days: number): Promise<SiteStats> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return EMPTY(days);
  }
  const { data, error } = await getSupabase().rpc("site_stats", { _slug: slug, _days: days });
  if (error) throw error;
  return { ...EMPTY(days), ...(data as Partial<SiteStats>) };
}
