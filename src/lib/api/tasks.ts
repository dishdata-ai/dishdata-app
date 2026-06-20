import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/api/database.types";

const dTasks = demoTable<Task>("tasks");

export async function listTasks(orgId: string): Promise<Task[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTasks
      .list({ org_id: orgId } as Partial<Task>)
      .sort((a, b) => a.position - b.position);
  }
  const { data, error } = await getSupabase()
    .from("tasks")
    .select("*")
    .eq("org_id", orgId)
    .order("position");
  if (error) throw error;
  return data ?? [];
}

export interface NewTaskInput {
  title: string;
  description: string | null;
  priority: Task["priority"];
  assignee_employee_id: string | null;
  partner_email: string | null;
  due_date: string | null;
}

export async function createTask(orgId: string, input: NewTaskInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTasks.insert({
      id: uid(), org_id: orgId, status: "todo", position: Date.now(),
      completed_at: null, created_at: new Date().toISOString(), ...input,
    });
    return;
  }
  const { error } = await getSupabase()
    .from("tasks")
    .insert({ org_id: orgId, position: Date.now(), ...input });
  if (error) throw error;
}

export async function updateTask(orgId: string, taskId: string, patch: Partial<Task>): Promise<void> {
  if (patch.status) {
    patch.completed_at = patch.status === "done" ? new Date().toISOString() : null;
  }
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTasks.update(taskId, patch);
    return;
  }
  const { error } = await getSupabase()
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function deleteTask(orgId: string, taskId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTasks.remove(taskId);
    return;
  }
  const { error } = await getSupabase().from("tasks").delete().eq("id", taskId).eq("org_id", orgId);
  if (error) throw error;
}

export type { TaskStatus };
