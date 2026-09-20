import type { ChecklistItem, Task, TaskPhoto } from "@/lib/api/database.types";

// Daily tasks reset without a cron job: completed_at doubles as "last touched",
// and anything last touched before today reads as not done yet.
const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

export const isFresh = (t: Task) => isToday(t.completed_at);
export const isDoneToday = (t: Task) => t.status === "done" && isFresh(t);
export const stepsToday = (t: Task): ChecklistItem[] =>
  (t.checklist ?? []).map((c) => ({ ...c, done: isFresh(t) && c.done }));

/** Proof photos uploaded today — yesterday's don't count toward today's checklist. */
export const proofToday = (t: Task): TaskPhoto[] => (t.proof_photos ?? []).filter((p) => isToday(p.at));

/** Keeps the stored list from growing forever; files stay in storage, only the references are trimmed. */
export const recentProof = (t: Task, days = 14): TaskPhoto[] =>
  (t.proof_photos ?? []).filter((p) => Date.now() - new Date(p.at).getTime() < days * 86400000);
