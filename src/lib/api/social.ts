import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { SocialPost, SocialTarget, SocialPlatform } from "@/lib/api/database.types";

const dPosts = demoTable<SocialPost>("social_posts");
const dTargets = demoTable<SocialTarget>("social_targets");

export const PLATFORMS: { id: SocialPlatform; label: string; color: string }[] = [
  { id: "instagram", label: "Instagram", color: "#f472b6" },
  { id: "tiktok", label: "TikTok", color: "#22d3ee" },
  { id: "facebook", label: "Facebook", color: "#60a5fa" },
  { id: "google", label: "Google Business", color: "#fbbf24" },
];

export const platformInfo = (id: SocialPlatform) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];

export type NewPost = Omit<SocialPost, "id" | "org_id" | "created_at">;

export async function listPosts(orgId: string): Promise<SocialPost[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPosts.list({ org_id: orgId } as Partial<SocialPost>);
  }
  const { data, error } = await getSupabase()
    .from("social_posts")
    .select("*")
    .eq("org_id", orgId)
    .order("scheduled_for", { nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPost(orgId: string, input: NewPost): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPosts.insert({ id: uid(), org_id: orgId, created_at: new Date().toISOString(), ...input });
    return;
  }
  const { error } = await getSupabase().from("social_posts").insert({ org_id: orgId, ...input });
  if (error) throw error;
}

export async function updatePost(orgId: string, id: string, patch: Partial<NewPost>): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPosts.update(id, patch);
    return;
  }
  const { error } = await getSupabase().from("social_posts").update(patch).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

export async function deletePost(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPosts.remove(id);
    return;
  }
  const { error } = await getSupabase().from("social_posts").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

export async function listTargets(orgId: string): Promise<SocialTarget[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTargets.list({ org_id: orgId } as Partial<SocialTarget>);
  }
  const { data, error } = await getSupabase().from("social_targets").select("*").eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}

export type TargetValues = Pick<SocialTarget, "posts_per_week" | "followers_now" | "followers_goal">;

/** One row per platform: update it if it exists, create it otherwise. */
export async function saveTarget(orgId: string, platform: SocialPlatform, values: TargetValues, existingId?: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    if (existingId) dTargets.update(existingId, values);
    else dTargets.insert({ id: uid(), org_id: orgId, platform, ...values });
    return;
  }
  const sb = getSupabase();
  const { error } = existingId
    ? await sb.from("social_targets").update(values).eq("id", existingId).eq("org_id", orgId)
    : await sb.from("social_targets").insert({ org_id: orgId, platform, ...values });
  if (error) throw error;
}
