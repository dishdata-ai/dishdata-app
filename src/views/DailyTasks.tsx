"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, Circle, ChevronDown, Link2, Square, CheckSquare } from "lucide-react";
import { SectionTitle, Card, Badge, EmptyState, PageSkeleton } from "@/components/ui";
import { useTasks, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { updateTask } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Task, StaffRole, ChecklistItem } from "@/lib/api/database.types";

type Tone = "green" | "amber" | "rose" | "violet" | "cyan" | "neutral";

const ROLE_ORDER: (StaffRole | null)[] = ["frontend", "kitchen_lead", "commi_kitchen", "manager", "admin", "owner", null];

const ROLE_LABELS: Record<StaffRole, string> = {
  frontend: "Frontend",
  kitchen_lead: "Kitchen Lead / Head Chef",
  commi_kitchen: "Commi Kitchen / Kitchen Helper",
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
};

const ROLE_TONES: Record<StaffRole, Tone> = {
  frontend: "cyan",
  kitchen_lead: "amber",
  commi_kitchen: "violet",
  owner: "rose",
  admin: "rose",
  manager: "amber",
};

const roleLabel = (r: StaffRole | null) => (r ? ROLE_LABELS[r] : "Unassigned — decide who later");
const roleTone = (r: StaffRole | null): Tone => (r ? ROLE_TONES[r] : "neutral");

const isImageUrl = (url: string) => /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url);

// Daily tasks reset without a cron job: completed_at doubles as "last touched",
// and anything last touched before today reads as not done yet.
const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
const isFresh = (t: Task) => isToday(t.completed_at);
const isDone = (t: Task) => t.status === "done" && isFresh(t);
const stepsToday = (t: Task): ChecklistItem[] =>
  (t.checklist ?? []).map((c) => ({ ...c, done: isFresh(t) && c.done }));

export default function DailyTasks() {
  const { org } = useOrg();
  const tasksQ = useTasks();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const daily = (tasksQ.data ?? []).filter((t) => t.is_daily && !t.is_partner_task);
    return ROLE_ORDER.map((role) => ({
      role,
      tasks: daily.filter((t) => t.assigned_role === role).sort((a, b) => a.position - b.position),
    })).filter((g) => g.tasks.length > 0);
  }, [tasksQ.data]);

  const save = async (task: Task, patch: Partial<Task>) => {
    try {
      await updateTask(org!.id, task.id, patch);
      invalidate("tasks");
    } catch (e) {
      toast.error("Could not update task", e instanceof Error ? e.message : "");
    }
  };

  const toggleTask = (task: Task) => {
    const now = new Date().toISOString();
    if (isDone(task)) {
      save(task, { status: "todo", completed_at: now, checklist: stepsToday(task).map((c) => ({ ...c, done: false })) });
    } else {
      save(task, { status: "done", completed_at: now, checklist: stepsToday(task).map((c) => ({ ...c, done: true })) });
    }
  };

  const toggleStep = (task: Task, stepId: string) => {
    const next = stepsToday(task).map((c) => (c.id === stepId ? { ...c, done: !c.done } : c));
    save(task, {
      checklist: next,
      status: next.every((c) => c.done) ? "done" : "todo",
      completed_at: new Date().toISOString(),
    });
  };

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (tasksQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Daily Tasks"
        subtitle="Role-based checklists that reset every day. Attach a “how it should look” photo to a task as a link on the Tasks board."
      />

      {groups.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No daily tasks yet" hint="Create tasks on the Tasks board and mark them as daily." />
      ) : (
        <div className="space-y-4">
          {groups.map(({ role, tasks }) => {
            const done = tasks.filter(isDone).length;
            return (
              <Card key={role ?? "unassigned"} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Badge tone={roleTone(role)}>{roleLabel(role)}</Badge>
                    <span className="text-sm text-zinc-400">
                      {done} / {tasks.length} done today
                    </span>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-brand-400 transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
                  </div>
                </div>

                <div className="divide-y divide-line/60">
                  {tasks.map((task) => {
                    const steps = stepsToday(task);
                    const links = task.links ?? [];
                    const expandable = steps.length > 0 || links.length > 0;
                    const expanded = open.has(task.id);
                    const finished = isDone(task);
                    return (
                      <div key={task.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggleTask(task)}
                            aria-label={finished ? "Mark not done" : "Mark done"}
                            className="mt-0.5 shrink-0 cursor-pointer text-zinc-400 transition-colors hover:text-white"
                          >
                            {finished ? <CheckCircle2 className="h-5 w-5 text-brand-400" /> : <Circle className="h-5 w-5" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <h4 className={cn("text-sm font-medium", finished && "text-zinc-500 line-through")}>{task.title}</h4>
                            {task.description && <p className="mt-0.5 text-xs text-zinc-400">{task.description}</p>}
                            {expandable && (
                              <button
                                onClick={() => toggleOpen(task.id)}
                                className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-400 hover:text-white"
                              >
                                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                                {steps.length > 0 && `${steps.filter((c) => c.done).length}/${steps.length} steps`}
                                {steps.length > 0 && links.length > 0 && " · "}
                                {links.length > 0 && `${links.length} reference${links.length > 1 ? "s" : ""}`}
                              </button>
                            )}
                            {expanded && (
                              <div className="mt-2 space-y-2">
                                {steps.map((c) => (
                                  <button
                                    key={c.id}
                                    onClick={() => toggleStep(task, c.id)}
                                    className="flex w-full cursor-pointer items-center gap-2 text-left text-sm text-zinc-300 hover:text-white"
                                  >
                                    {c.done ? <CheckSquare className="h-4 w-4 text-brand-400" /> : <Square className="h-4 w-4 text-zinc-500" />}
                                    <span className={cn(c.done && "text-zinc-500 line-through")}>{c.text}</span>
                                  </button>
                                ))}
                                {links.map((l) =>
                                  isImageUrl(l.url) ? (
                                    <a key={l.id} href={l.url} target="_blank" rel="noreferrer" className="block w-fit">
                                      <img src={l.url} alt={l.label} className="max-h-48 rounded-lg ring-1 ring-white/10" />
                                      <span className="mt-1 block text-xs text-zinc-400">{l.label}</span>
                                    </a>
                                  ) : (
                                    <a
                                      key={l.id}
                                      href={l.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-1.5 text-xs text-accent-400 hover:underline"
                                    >
                                      <Link2 className="h-3.5 w-3.5" /> {l.label}
                                    </a>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                          <Badge tone={task.priority === "high" ? "rose" : task.priority === "medium" ? "amber" : "neutral"} className="shrink-0">
                            {task.priority}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
