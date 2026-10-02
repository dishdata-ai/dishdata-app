import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { DutyAssignment } from "@/lib/types";

/** Who holds which duty. Readable by every member, so colleagues can see who covers what. */
export async function listDuties(orgId: string): Promise<DutyAssignment[]> {
  if (!isSupabaseConfigured) return demo.duties;
  const { data, error } = await getSupabase().from("duty_assignments").select("*").eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as DutyAssignment[];
}
