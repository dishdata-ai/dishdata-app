import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { Campaign, Customer } from "@/lib/api/database.types";

const dCampaigns = demoTable<Campaign>("campaigns");

export async function listCampaigns(orgId: string): Promise<Campaign[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dCampaigns
      .list({ org_id: orgId } as Partial<Campaign>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("campaigns")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type SegmentSpec = Campaign["segment"];

/** Which customers match a segment spec — used for live preview and "send". */
export function matchSegment(customers: Customer[], segment: SegmentSpec): Customer[] {
  return customers.filter((c) => {
    if (segment.tier && c.tier !== segment.tier) return false;
    if (segment.min_visits && c.visits < segment.min_visits) return false;
    if (segment.inactive_days) {
      if (!c.last_visit_at) return true;
      const days = (Date.now() - new Date(c.last_visit_at).getTime()) / 86400000;
      if (days < segment.inactive_days) return false;
    }
    return true;
  });
}

export async function createCampaign(
  orgId: string,
  input: Pick<Campaign, "name" | "channel" | "segment">,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dCampaigns.insert({
      id: uid(), org_id: orgId, status: "draft", scheduled_at: null, stats: {},
      created_at: new Date().toISOString(), ...input,
    });
    return;
  }
  const { error } = await getSupabase().from("campaigns").insert({ org_id: orgId, ...input });
  if (error) throw error;
}

/** Simulated send: marks sent and records plausible engagement stats. */
export async function sendCampaign(orgId: string, campaign: Campaign, audienceSize: number): Promise<void> {
  const stats = {
    sent: audienceSize,
    opened: Math.round(audienceSize * (0.35 + Math.random() * 0.2)),
    redeemed: Math.round(audienceSize * (0.08 + Math.random() * 0.08)),
  };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dCampaigns.update(campaign.id, { status: "sent", stats });
    return;
  }
  const { error } = await getSupabase()
    .from("campaigns")
    .update({ status: "sent", stats })
    .eq("id", campaign.id)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function deleteCampaign(orgId: string, campaignId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dCampaigns.remove(campaignId);
    return;
  }
  const { error } = await getSupabase().from("campaigns").delete().eq("id", campaignId).eq("org_id", orgId);
  if (error) throw error;
}
