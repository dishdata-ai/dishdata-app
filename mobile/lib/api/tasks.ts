import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo } from "@/lib/demo";
import type { Task, TaskStatus } from "@/lib/types";

export async function listTasks(orgId: string): Promise<Task[]> {
  if (!isSupabaseConfigured) {
    return [...demo.tasks].sort((a, b) => a.position - b.position);
  }
  const { data, error } = await getSupabase()
    .from("tasks")
    .select("*")
    .eq("org_id", orgId)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

export async function setTaskStatus(
  orgId: string,
  taskId: string,
  status: TaskStatus,
): Promise<void> {
  const completed_at = status === "done" ? new Date().toISOString() : null;
  if (!isSupabaseConfigured) {
    const t = demo.tasks.find((x) => x.id === taskId);
    if (t) {
      t.status = status;
      t.completed_at = completed_at;
    }
    return;
  }
  const { error } = await getSupabase()
    .from("tasks")
    .update({ status, completed_at })
    .eq("id", taskId)
    .eq("org_id", orgId);
  if (error) throw error;
}
