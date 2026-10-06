import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import { recentProof } from "@/lib/daily";
import type { Task, TaskPhoto } from "@/lib/types";

/**
 * Upload a proof photo for a daily task and attach it to the task. Same bucket and path shape as the website
 * (org-assets/<org>/daily/<task>/…), so a photo taken on the phone shows up on the web board and vice versa.
 * `uri` is a local file from the camera.
 */
export async function addProofPhoto(orgId: string, task: Task, uri: string, by: string | null): Promise<void> {
  const at = new Date().toISOString();
  if (!isSupabaseConfigured) {
    // Demo has no storage: keep the local file reference so the flow can be tried end to end.
    const t = demo.tasks.find((x) => x.id === task.id);
    if (t) t.proof_photos = [...recentProof(t), { id: uid(), url: uri, by, at }];
    return;
  }
  const sb = getSupabase();
  const bytes = await (await fetch(uri)).arrayBuffer();
  const path = `${orgId}/daily/${task.id}/proof-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from("org-assets").upload(path, bytes, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (upErr) throw upErr;
  const url = sb.storage.from("org-assets").getPublicUrl(path).data.publicUrl;

  // Re-read the task so two people adding a photo at once don't overwrite each other's.
  const { data: fresh, error: readErr } = await sb.from("tasks").select("proof_photos").eq("id", task.id).eq("org_id", orgId).single();
  if (readErr) throw readErr;
  const current = ((fresh?.proof_photos ?? []) as TaskPhoto[]).filter(
    (p) => Date.now() - new Date(p.at).getTime() < 14 * 86400000,
  );
  const { error } = await sb
    .from("tasks")
    .update({ proof_photos: [...current, { id: uid(), url, by, at }] })
    .eq("id", task.id)
    .eq("org_id", orgId);
  if (error) throw error;
}
