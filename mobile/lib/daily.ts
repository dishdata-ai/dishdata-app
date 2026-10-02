import type { ChecklistItem, Task, TaskPhoto } from "@/lib/types";

// Daily tasks reset without a cron job: completed_at doubles as "last touched",
// and anything last touched before today reads as not done yet. Same rule as the web app (src/lib/daily.ts).
const isToday = (iso: string | null | undefined) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

export const isFresh = (t: Task) => isToday(t.completed_at);
export const isDoneToday = (t: Task) => t.status === "done" && isFresh(t);
export const stepsToday = (t: Task): ChecklistItem[] =>
  (t.checklist ?? []).map((c) => ({ ...c, done: isFresh(t) && c.done }));

/** Proof photos uploaded today — yesterday's don't count toward today's checklist. */
export const proofToday = (t: Task): TaskPhoto[] => (t.proof_photos ?? []).filter((p) => isToday(p.at));
