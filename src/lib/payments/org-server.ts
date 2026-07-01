import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Org } from "@/lib/api/database.types";

export interface ResolvedOrg {
  sb: SupabaseClient;
  userId: string;
  org: Org;
  /** True if the caller owns/admins the org (allowed to manage payment settings). */
  isAdmin: boolean;
}

export type OrgResolution =
  | { ok: true; value: ResolvedOrg }
  | { ok: false; status: number; error: string };

/**
 * Resolve the signed-in user's active org for a route handler. Mirrors
 * fetchMyOrgContext: prefer profiles.active_org_id, else the first membership.
 *
 * Accepts either a browser cookie session (web) or an `Authorization: Bearer
 * <supabase access token>` header (mobile app, which has no cookies). Pass the
 * Request when calling from a route that mobile hits.
 */
export async function resolveActiveOrg(req?: Request): Promise<OrgResolution> {
  const bearer = req?.headers.get("authorization");
  let sb: SupabaseClient | null;
  let userId: string | undefined;

  if (bearer?.startsWith("Bearer ")) {
    const token = bearer.slice(7);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return { ok: false, status: 400, error: "Supabase backend not configured." };
    }
    // Token-bound client: PostgREST runs as this user (RLS enforced).
    sb = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await sb.auth.getUser(token);
    userId = data.user?.id;
  } else {
    sb = await createSupabaseServerClient();
    if (!sb) {
      return { ok: false, status: 400, error: "Payments require a connected Supabase backend (not available in demo mode)." };
    }
    const { data } = await sb.auth.getUser();
    userId = data.user?.id;
  }

  if (!userId) return { ok: false, status: 401, error: "Not signed in." };
  const user = { id: userId };

  const { data: memberships, error } = await sb
    .from("org_members")
    .select("role, orgs(*)")
    .eq("user_id", user.id);
  if (error) return { ok: false, status: 500, error: error.message };
  if (!memberships || memberships.length === 0) {
    return { ok: false, status: 404, error: "No organization found for this user." };
  }

  const { data: profile } = await sb.from("profiles").select("active_org_id").eq("id", user.id).single();
  const active =
    memberships.find((m) => (m.orgs as unknown as Org)?.id === profile?.active_org_id) ?? memberships[0];

  return {
    ok: true,
    value: {
      sb,
      userId: user.id,
      org: active.orgs as unknown as Org,
      isAdmin: active.role === "owner" || active.role === "admin",
    },
  };
}
