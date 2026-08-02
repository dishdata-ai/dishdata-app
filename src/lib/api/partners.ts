// Partner Hub: skill profiles + kudos. Partner-space visibility is enforced
// by RLS (can_see_partner_tasks) — these repos just read/write.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { PartnerProfile, Kudo } from "@/lib/api/database.types";

const dProfiles = demoTable<PartnerProfile>("partner_profiles");
const dKudos = demoTable<Kudo>("kudos");

export async function listPartnerProfiles(orgId: string): Promise<PartnerProfile[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dProfiles.list({ org_id: orgId } as Partial<PartnerProfile>);
  }
  const { data, error } = await getSupabase()
    .from("partner_profiles")
    .select("*")
    .eq("org_id", orgId);
  if (error) throw error;
  return data ?? [];
}

export interface PartnerProfileInput {
  skills: string[];
  focus: string | null;
  location: string | null;
}

export async function upsertPartnerProfile(
  orgId: string,
  userId: string,
  input: PartnerProfileInput,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dProfiles
      .list({ org_id: orgId } as Partial<PartnerProfile>)
      .find((p) => p.user_id === userId);
    if (existing) dProfiles.update(existing.id, { ...input, updated_at: new Date().toISOString() });
    else
      dProfiles.insert({
        id: uid(), org_id: orgId, user_id: userId,
        updated_at: new Date().toISOString(), ...input,
      });
    return;
  }
  const { error } = await getSupabase()
    .from("partner_profiles")
    .upsert({ org_id: orgId, user_id: userId, ...input }, { onConflict: "org_id,user_id" });
  if (error) throw error;
}

export async function listKudos(orgId: string): Promise<Kudo[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dKudos
      .list({ org_id: orgId } as Partial<Kudo>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("kudos")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export interface NewKudoInput {
  to_user: string;
  message: string;
  emoji: string;
  task_id?: string | null;
}

export async function giveKudos(orgId: string, fromUser: string, input: NewKudoInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dKudos.insert({
      id: uid(), org_id: orgId, from_user: fromUser, task_id: null,
      created_at: new Date().toISOString(), ...input,
    });
    return;
  }
  const { error } = await getSupabase()
    .from("kudos")
    .insert({ org_id: orgId, from_user: fromUser, ...input });
  if (error) throw error;
}
