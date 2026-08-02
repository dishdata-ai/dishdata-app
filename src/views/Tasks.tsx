import { useMemo, useState, type DragEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, KanbanSquare, Trash2, CalendarDays, Handshake, LayoutList, Play, CheckCircle2 } from "lucide-react";
import {
  Card,
  SectionTitle,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { useTasks, useEmployees, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { createTask, updateTask, deleteTask } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import PartnerBoard from "@/views/PartnerBoard";
import type { Task, TaskStatus, TaskPriority } from "@/lib/api/database.types";

const columns: { status: TaskStatus; title: string; tone: string }[] = [
  { status: "todo", title: "To Do", tone: "#22d3ee" },
  { status: "in_progress", title: "In Progress", tone: "#fbbf24" },
  { status: "done", title: "Done", tone: "#34d399" },
];

const priorityTone: Record<TaskPriority, "rose" | "amber" | "neutral"> = {
  high: "rose",
  medium: "amber",
  low: "neutral",
};

function NewTaskForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium" as TaskPriority,
    assignee: "",
    partnerEmail: "",
    dueDate: "",
  });

  const create = useMutation({
    mutationFn: () =>
      createTask(org!.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        assignee_employee_id: form.assignee || null,
        partner_email: form.partnerEmail.trim() || null,
        due_date: form.dueDate || null,
      }),
    onSuccess: () => {
      invalidate("tasks");
      toast.success("Task created", form.title.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not create task", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Calibrate oven #2" autoFocus />
      </Field>
      <Field label="Details (optional)">
        <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Anything the assignee should know" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
        </Field>
      </div>
      <Field label="Assign to employee">
        <Select value={form.assignee} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}>
          <option value="">Unassigned</option>
          {(employeesQ.data ?? []).map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.name} · {emp.role_title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Or delegate to an external contractor (email)">
        <Input
          type="email"
          value={form.partnerEmail}
          onChange={(e) => setForm((f) => ({ ...f, partnerEmail: e.target.value }))}
          placeholder="contractor@partnerco.com"
        />
      </Field>
      <Button className="w-full" disabled={!form.title.trim() || create.isPending} onClick={() => create.mutate()}>
        Create Task
      </Button>
    </div>
  );
}

export default function Tasks() {
  const { org, isPartner } = useOrg();
  const tasksQ = useTasks();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("tasks", ["tasks"]);

  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [showPartnerOnly, setShowPartnerOnly] = useState(false);
  const [view, setView] = useState<"board" | "list">("board");
  // Partners land on their own space; employees only ever have "team".
  const [space, setSpace] = useState<"team" | "partners">(isPartner ? "partners" : "team");

  const teamTasks = useMemo(() => (tasksQ.data ?? []).filter((t) => !t.is_partner_task), [tasksQ.data]);
  const tasks = useMemo(
    () => teamTasks.filter((t) => !showPartnerOnly || t.partner_email),
    [teamTasks, showPartnerOnly],
  );
  const employees = employeesQ.data ?? [];

  const move = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    try {
      await updateTask(org!.id, task.id, { status, position: Date.now() });
      invalidate("tasks");
      if (status === "done") toast.success("Task completed", task.title);
    } catch (e) {
      toast.error("Could not move task", e instanceof Error ? e.message : "");
    }
  };

  const remove = async (task: Task) => {
    try {
      await deleteTask(org!.id, task.id);
      invalidate("tasks");
      toast.info("Task deleted", task.title);
    } catch (e) {
      toast.error("Could not delete task", e instanceof Error ? e.message : "");
    }
  };

  const onDrop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOverCol(null);
    const task = tasks.find((t) => t.id === dragId);
    if (task) move(task, status);
    setDragId(null);
  };

  const advance = (t: Task) => move(t, t.status === "todo" ? "in_progress" : "done");

  if (tasksQ.isLoading) return <PageSkeleton />;

  const partnerCount = teamTasks.filter((t) => t.partner_email && t.status !== "done").length;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Tasks"
        subtitle={
          space === "partners"
            ? "Private partner space — assign to each other, track effort, celebrate wins."
            : "Drag cards between columns. Assign to staff or delegate to contractors."
        }
        action={
          space === "team" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPartnerOnly((v) => !v)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                  showPartnerOnly
                    ? "border-violet-soft/40 bg-violet-soft/10 text-violet-soft"
                    : "border-line bg-white/[0.03] text-zinc-400 hover:text-white",
                )}
              >
                <Handshake className="h-3.5 w-3.5" /> Contractor tasks {partnerCount > 0 && `(${partnerCount})`}
              </button>
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New Task
              </Button>
            </div>
          ) : undefined
        }
      />

      {isPartner && (
        <div className="flex w-fit rounded-full border border-line bg-white/[0.03] p-0.5">
          <button
            onClick={() => setSpace("partners")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
              space === "partners" ? "bg-violet-soft/15 text-violet-soft" : "text-zinc-500 hover:text-white",
            )}
          >
            <Handshake className="h-3.5 w-3.5" /> Partners
          </button>
          <button
            onClick={() => setSpace("team")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
              space === "team" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white",
            )}
          >
            <KanbanSquare className="h-3.5 w-3.5" /> Team
          </button>
        </div>
      )}

      {space === "team" && teamTasks.length > 0 && (
        <div className="flex w-fit rounded-full border border-line bg-white/[0.03] p-0.5">
          <button
            onClick={() => setView("board")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              view === "board" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white",
            )}
          >
            <KanbanSquare className="h-3.5 w-3.5" /> Board
          </button>
          <button
            onClick={() => setView("list")}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              view === "list" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white",
            )}
          >
            <LayoutList className="h-3.5 w-3.5" /> List
          </button>
        </div>
      )}

      {space === "partners" && isPartner ? (
        <PartnerBoard />
      ) : teamTasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No tasks yet"
            hint="Create tasks for your team or delegate work to external contractors."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New Task
              </Button>
            }
          />
        </Card>
      ) : view === "board" ? (
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((col) => {
            const colTasks = tasks
              .filter((t) => t.status === col.status)
              .sort((a, b) => a.position - b.position);
            return (
              <div
                key={col.status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col.status);
                }}
                onDragLeave={() => setOverCol(null)}
                onDrop={(e) => onDrop(e, col.status)}
                className={cn(
                  "space-y-3 rounded-2xl p-2 transition-all",
                  overCol === col.status && "bg-white/[0.03] ring-1 ring-brand-400/30",
                )}
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.tone }} />
                  <h3 className="font-semibold text-white">{col.title}</h3>
                  <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs font-bold text-zinc-400">
                    {colTasks.length}
                  </span>
                </div>
                {colTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-zinc-600">
                    Drop tasks here
                  </div>
                ) : (
                  colTasks.map((t) => {
                    const assignee = employees.find((e) => e.id === t.assignee_employee_id);
                    const overdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date();
                    return (
                      <Card
                        key={t.id}
                        className={cn(
                          "cursor-grab p-4 transition-all active:cursor-grabbing",
                          dragId === t.id && "opacity-40",
                        )}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        {...({ draggable: true } as any)}
                      >
                        <div
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => setDragId(null)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-sm font-semibold text-white", t.status === "done" && "text-zinc-500 line-through")}>
                              {t.title}
                            </p>
                            <button
                              onClick={() => remove(t)}
                              className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-600 hover:text-rose-soft"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {t.description && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{t.description}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <Badge tone={priorityTone[t.priority]} className="capitalize">{t.priority}</Badge>
                            {assignee && (
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-zinc-950"
                                style={{
                                  background: `linear-gradient(135deg, hsl(${assignee.avatar_hue} 70% 65%), hsl(${assignee.avatar_hue + 40} 70% 55%))`,
                                }}
                                title={assignee.name}
                              >
                                {assignee.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                              </span>
                            )}
                            {t.partner_email && (
                              <Badge tone="violet">
                                <Handshake className="h-3 w-3" /> contractor
                              </Badge>
                            )}
                            {t.due_date && (
                              <span className={cn("inline-flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-rose-soft" : "text-zinc-500")}>
                                <CalendarDays className="h-3 w-3" />
                                {new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          {/* Tap-friendly status move for touch devices */}
                          <div className="mt-3 flex gap-1 md:hidden">
                            {columns
                              .filter((c) => c.status !== t.status)
                              .map((c) => (
                                <button
                                  key={c.status}
                                  onClick={() => move(t, c.status)}
                                  className="flex-1 cursor-pointer rounded-lg border border-line py-1 text-[11px] text-zinc-400"
                                >
                                  → {c.title}
                                </button>
                              ))}
                          </div>
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // List view grouped by assignee, Asana-style
        <div className="space-y-4">
          {[
            ...employees.map((e) => ({ key: e.id, name: e.name, hue: e.avatar_hue as number | null })),
            { key: "", name: "Unassigned", hue: null as number | null },
          ].map(({ key, name, hue }) => {
            const rows = tasks
              .filter((t) => (key ? t.assignee_employee_id === key : !t.assignee_employee_id))
              .sort((a, b) =>
                a.status === b.status ? a.position - b.position : a.status === "done" ? 1 : b.status === "done" ? -1 : 0,
              );
            if (rows.length === 0) return null;
            return (
              <Card key={key || "unassigned"} className="p-0">
                <div className="flex items-center gap-2.5 border-b border-line p-3">
                  {hue !== null ? (
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-zinc-950"
                      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 65%), hsl(${hue + 40} 70% 55%))` }}
                    >
                      {name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </span>
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] font-bold text-zinc-500">
                      —
                    </span>
                  )}
                  <p className="font-semibold text-white">{name}</p>
                  <span className="ml-auto text-xs text-zinc-500">
                    {rows.filter((t) => t.status !== "done").length} open
                  </span>
                </div>
                <div className="divide-y divide-line/60">
                  {rows.map((t) => {
                    const overdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date();
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: columns.find((c) => c.status === t.status)?.tone }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-medium text-white", t.status === "done" && "text-zinc-500 line-through")}>
                            {t.title}
                          </p>
                          <p className="text-[11px] text-zinc-500">
                            {t.status === "in_progress" ? "In progress" : t.status === "done" ? "Done" : "To do"}
                            {t.partner_email && " · contractor"}
                            {t.due_date && (
                              <span className={cn(overdue && "font-semibold text-rose-soft")}>
                                {" · due "}
                                {new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </p>
                        </div>
                        <Badge tone={priorityTone[t.priority]} className="shrink-0 capitalize">{t.priority}</Badge>
                        {t.status !== "done" ? (
                          <Button variant="ghost" className="shrink-0 px-2.5 py-1 text-xs" onClick={() => advance(t)}>
                            {t.status === "todo" ? (
                              <>
                                <Play className="h-3 w-3" /> Start
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3" /> Done
                              </>
                            )}
                          </Button>
                        ) : (
                          <button
                            onClick={() => remove(t)}
                            className="shrink-0 cursor-pointer rounded p-1 text-zinc-600 hover:text-rose-soft"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="New Task">
        <NewTaskForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
