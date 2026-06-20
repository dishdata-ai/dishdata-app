import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { Notification, AuditEntry } from "@/lib/api/database.types";

const dNotifications = demoTable<Notification>("notifications");
const dAudit = demoTable<AuditEntry>("audit_log");

export async function listNotifications(orgId: string, limit = 20): Promise<Notification[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dNotifications
      .list({ org_id: orgId } as Partial<Notification>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("notifications")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function markAllRead(orgId: string): Promise<void> {
  const now = new Date().toISOString();
  if (!isSupabaseConfigured) {
    await demoDelay();
    for (const n of dNotifications.list({ org_id: orgId } as Partial<Notification>)) {
      if (!n.read_at) dNotifications.update(n.id, { read_at: now });
    }
    return;
  }
  const { error } = await getSupabase()
    .from("notifications")
    .update({ read_at: now })
    .eq("org_id", orgId)
    .is("read_at", null);
  if (error) throw error;
}

/** Demo-mode helper: push a local notification (server triggers handle this when connected). */
export function pushDemoNotification(orgId: string, type: string, title: string, body: string, ref?: string) {
  if (isSupabaseConfigured) return;
  dNotifications.insert({
    id: uid(), org_id: orgId, user_id: null, type, title, body, ref: ref ?? null,
    read_at: null, created_at: new Date().toISOString(),
  });
}

export async function listAudit(orgId: string, limit = 100): Promise<AuditEntry[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dAudit
      .list({ org_id: orgId } as Partial<AuditEntry>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("audit_log")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Demo-mode helper: record an audit entry (a DB trigger handles this when connected). */
export function pushDemoAudit(orgId: string, table: string, action: string, rowId: string, detail?: Record<string, unknown>) {
  if (isSupabaseConfigured) return;
  dAudit.insert({
    id: uid(), org_id: orgId, actor: "demo-user", table_name: table, action,
    row_id: rowId, detail: detail ?? null, created_at: new Date().toISOString(),
  });
}
