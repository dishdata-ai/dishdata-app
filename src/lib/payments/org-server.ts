import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 */
export async function resolveActiveOrg(): Promise<OrgResolution> {
  const sb = await createSupabaseServerClient();
  if (!sb) {
    return { ok: false, status: 400, error: "Payments require a connected Supabase backend (not available in demo mode)." };
  }

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Not signed in." };

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
