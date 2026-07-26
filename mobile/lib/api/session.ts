import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Org, Employee, Role } from "@/lib/types";

export interface OrgContext {
  org: Org;
  me: Employee;
  // From org_members.role — distinct from Employee.role_title (free text,
  // e.g. "Floor Lead"). Gates admin/manager-only UI (e.g. the org-wide
  // delivery view on My Day).
  role: Role;
}

/** Resolve the signed-in user's active org, employee record, and org role. */
export async function getOrgContext(): Promise<OrgContext | null> {
  if (!isSupabaseConfigured) {
    // "owner" so demo mode showcases the manager view too, alongside the
    // rider's own assigned-deliveries view — same single-persona precedent
    // as the rest of the mobile app's demo mode (no per-role tab gating yet).
    return { org: demo.org, me: demo.me, role: "owner" };
  }
  const sb = getSupabase();
  // Use getSession() (local read from AsyncStorage, auto-refreshes the token
  // only if needed) rather than getUser() (a hard network call to re-validate).
  // getUser() on every app reopen was the cause of "works first time, blank on
  // every reopen after": on a cold start / flaky network it returned null (or
  // threw), nulling the whole context. getSession() restores reliably offline.
  const {
    data: { session },
  } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return null; // genuinely no session → logged out

  // With a valid session, a query error means a transient network/DB hiccup,
  // NOT "logged out" — throw so the provider keeps the existing context instead
  // of blanking the app. Returning null is reserved for a real no-session state.
  const { data: profile, error: profileErr } = await sb
    .from("profiles")
    .select("active_org_id")
    .eq("id", user.id)
    .single();
  if (profileErr) throw profileErr;
  const orgId = profile?.active_org_id;
  if (!orgId) return null;

  const { data: org, error: orgErr } = await sb
    .from("orgs")
    .select("*")
    .eq("id", orgId)
    .single();
  if (orgErr) throw orgErr;
  const { data: emp } = await sb
    .from("employees")
    .select("*")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: member } = await sb
    .from("org_members")
    .select("role")
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
    role: (member?.role as Role) ?? "staff",
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
