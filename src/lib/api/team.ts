import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoDelay } from "@/lib/api/demoDb";
import type { Invite, OrgMember, ModuleAccess, Role } from "@/lib/api/database.types";

const DEMO_MEMBER: OrgMember = {
  org_id: "demo",
  user_id: "demo-user",
  role: "owner",
  joined_at: new Date().toISOString(),
  email: "demo@dishdata.app",
  full_name: "Demo Owner",
};

export async function listMembers(orgId: string): Promise<OrgMember[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return [{ ...DEMO_MEMBER, org_id: orgId }];
  }
  const sb = getSupabase();
  const { data: members, error } = await sb
    .from("org_members")
    .select("org_id, user_id, role, joined_at")
    .eq("org_id", orgId)
    .order("joined_at");
  if (error) throw error;
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await sb.from("profiles").select("id, email, full_name").in("id", ids);
  return (members ?? []).map((m) => {
    const p = profiles?.find((x) => x.id === m.user_id);
    return { ...m, email: p?.email ?? null, full_name: p?.full_name ?? null } as OrgMember;
  });
}

export async function updateMemberRole(orgId: string, userId: string, role: Role): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Connect Supabase to manage team roles");
  const { error } = await getSupabase()
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Connect Supabase to manage team members");
  const { error } = await getSupabase()
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function listAllModuleAccess(orgId: string): Promise<ModuleAccess[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return [];
  }
  const { data, error } = await getSupabase()
    .from("member_module_access")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}

export async function setModuleAccess(
  orgId: string,
  userId: string,
  moduleId: string,
  canAccess: boolean,
): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Connect Supabase to manage module access");
  const { error } = await getSupabase()
    .from("member_module_access")
    .upsert(
      { org_id: orgId, user_id: userId, module_id: moduleId, can_access: canAccess },
      { onConflict: "org_id,user_id,module_id" },
    );
  if (error) throw error;
}

export async function listInvites(orgId: string): Promise<Invite[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return [];
  }
  const { data, error } = await getSupabase()
    .from("invites")
    .select("*")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createInvite(orgId: string, email: string, role: Role): Promise<Invite> {
  if (!isSupabaseConfigured) throw new Error("Connect Supabase to invite teammates");
  const { data, error } = await getSupabase()
    .from("invites")
    .insert({ org_id: orgId, email, role })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<void> {
  if (!isSupabaseConfigured) throw new Error("Connect Supabase to manage invites");
  const { error } = await getSupabase().from("invites").delete().eq("id", inviteId).eq("org_id", orgId);
  if (error) throw error;
}
