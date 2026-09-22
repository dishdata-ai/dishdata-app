import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { SocialAccount, SocialProvider } from "@/lib/api/database.types";
import { socialProviderById } from "@/lib/social/providers";

const dAccounts = demoTable<SocialAccount>("social_accounts");

/**
 * No credential column exists on this table (tokens live in social_credentials,
 * which the browser cannot read), so `select *` is safe.
 */
export async function listSocialAccounts(orgId: string): Promise<SocialAccount[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dAccounts.list({ org_id: orgId } as Partial<SocialAccount>);
  }
  const { data, error } = await getSupabase()
    .from("social_accounts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function setSocialAccountActive(orgId: string, id: string, active: boolean): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dAccounts.update(id, { is_active: active });
    return;
  }
  const { error } = await getSupabase()
    .from("social_accounts")
    .update({ is_active: active })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Deleting the account cascades to its credentials, targets and stored tokens. */
export async function disconnectSocialAccount(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dAccounts.remove(id);
    return;
  }
  const { error } = await getSupabase().from("social_accounts").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/**
 * Demo mode only: fabricate a connected account so the rest of the Marketing UI
 * can be walked without any platform credentials. Real orgs never call this —
 * they go through the provider's OAuth connect route.
 */
export async function connectDemoAccount(orgId: string, provider: SocialProvider): Promise<void> {
  if (isSupabaseConfigured) throw new Error("Demo accounts are only available in demo mode.");
  await demoDelay();
  const def = socialProviderById(provider);
  const now = new Date().toISOString();
  dAccounts.insert({
    id: uid(), org_id: orgId, provider,
    external_id: `demo-${provider}`,
    display_name: `${def.label} (demo)`,
    handle: provider === "instagram" || provider === "tiktok" ? "@kokoland.demo" : null,
    avatar_url: null, scopes: [], settings: {}, is_active: true, needs_reauth: false,
    token_expires_at: null, last_error: null, last_error_at: null, last_synced_at: now,
    created_at: now, updated_at: now, created_by: null,
  });
}
