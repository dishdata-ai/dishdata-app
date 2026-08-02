import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { Task, TaskStatus, TaskComment } from "@/lib/api/database.types";

const dTasks = demoTable<Task>("tasks");
const dComments = demoTable<TaskComment>("task_comments");

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
  /** Partner-space task — hidden from employees by RLS. */
  is_partner_task?: boolean;
  assignee_user_id?: string | null;
  effort?: number;
  category?: string | null;
}

export async function createTask(orgId: string, input: NewTaskInput): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dTasks.insert({
      id: uid(), org_id: orgId, status: "todo", position: Date.now(),
      completed_at: null, created_at: new Date().toISOString(),
      is_partner_task: false, assignee_user_id: null, effort: 1, category: null,
      checklist: [], links: [],
      ...input,
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

// --- Comments -------------------------------------------------------------
// Visibility mirrors the parent task (can_see_task) so partner-task threads
// stay hidden from employees.

export async function listComments(orgId: string, taskId: string): Promise<TaskComment[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dComments
      .list({ org_id: orgId, task_id: taskId } as Partial<TaskComment>)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await getSupabase()
    .from("task_comments")
    .select("*")
    .eq("org_id", orgId)
    .eq("task_id", taskId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export async function addComment(
  orgId: string,
  taskId: string,
  author: string,
  body: string,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dComments.insert({
      id: uid(), org_id: orgId, task_id: taskId, author, body,
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await getSupabase()
    .from("task_comments")
    .insert({ org_id: orgId, task_id: taskId, author, body });
  if (error) throw error;
}

export async function deleteComment(orgId: string, commentId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dComments.remove(commentId);
    return;
  }
  const { error } = await getSupabase()
    .from("task_comments")
    .delete()
    .eq("id", commentId)
    .eq("org_id", orgId);
  if (error) throw error;
}

export type { TaskStatus };
