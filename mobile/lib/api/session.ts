import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Org, Employee } from "@/lib/types";

export interface OrgContext {
  org: Org;
  me: Employee;
}

/** Resolve the signed-in user's active org + their employee record. */
export async function getOrgContext(): Promise<OrgContext | null> {
  if (!isSupabaseConfigured) {
    return { org: demo.org, me: demo.me };
  }
  const sb = getSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;

  const { data: profile } = await sb
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .single();
  const orgId = profile?.active_org_id;
  if (!orgId) return null;

  const { data: org } = await sb.from("orgs").select("*").eq("id", orgId).single();
  const { data: emp } = await sb
    .from("employees")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!org) return null;

  return {
    org: org as Org,
    me: (emp as Employee) ?? {
      id: user.id,
      org_id: orgId,
      user_id: user.id,
      name: user.email ?? "Me",
      role_title: "Staff",
      hourly_rate: 0,
      pin: null,
      shift_note: null,
      avatar_hue: 160,
      is_active: true,
    },
  };
}

export async function signIn(email: string, password: string) {
  const sb = getSupabase();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (!isSupabaseConfigured) return;
  await getSupabase().auth.signOut();
}
