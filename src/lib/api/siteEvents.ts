import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { WebsiteEvent } from "@/lib/api/database.types";

const dEvents = demoTable<WebsiteEvent>("website_events");

export type SiteEventInput = Pick<WebsiteEvent, "title" | "description" | "event_date" | "event_time" | "tag" | "cta_url" | "status">;

export async function listSiteEvents(orgId: string): Promise<WebsiteEvent[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dEvents.list({ org_id: orgId } as Partial<WebsiteEvent>);
  }
  const { data, error } = await getSupabase()
    .from("website_events")
    .select("*")
    .eq("org_id", orgId)
    .order("event_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function saveSiteEvent(orgId: string, input: SiteEventInput, existing?: WebsiteEvent): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    if (existing) dEvents.update(existing.id, { ...input, updated_at: now });
    else dEvents.insert({ id: uid(), org_id: orgId, created_at: now, updated_at: now, ...input });
    return;
  }
  const sb = getSupabase();
  const { error } = existing
    ? await sb.from("website_events").update(input).eq("id", existing.id).eq("org_id", orgId)
    : await sb.from("website_events").insert({ org_id: orgId, ...input });
  if (error) throw error;
}

export async function deleteSiteEvent(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dEvents.remove(id);
    return;
  }
  const { error } = await getSupabase().from("website_events").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
