import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import type { CateringInquiry, CateringInquiryStatus, CateringTier } from "@/lib/api/database.types";

const dCateringInquiries = demoTable<CateringInquiry>("catering_inquiries");
const demoOrgs = demoTable<{ id: string; settings: Record<string, unknown> }>("orgs");

export async function listCateringInquiries(orgId: string): Promise<CateringInquiry[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dCateringInquiries
      .list({ org_id: orgId } as Partial<CateringInquiry>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("catering_inquiries")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function setCateringInquiryStatus(id: string, status: CateringInquiryStatus): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dCateringInquiries.update(id, { status });
    return;
  }
  const { error } = await getSupabase().from("catering_inquiries").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Saves org.settings.cateringTiers only — same narrowly-scoped RPC pattern as setCategoryOrder. */
export async function setCateringTiers(orgId: string, tiers: CateringTier[]): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = demoOrgs.get(orgId);
    demoOrgs.update(orgId, { settings: { ...(org?.settings ?? {}), cateringTiers: tiers } });
    return;
  }
  const { error } = await getSupabase().rpc("set_catering_tiers", { _org: orgId, _tiers: tiers });
  if (error) throw error;
}
