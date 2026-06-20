import { useMemo, useState, type DragEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, KanbanSquare, Trash2, CalendarDays, Handshake } from "lucide-react";
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
      <Field label="Or delegate to a partner (email)">
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
  const { org } = useOrg();
  const tasksQ = useTasks();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("tasks", ["tasks"]);

  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [showPartnerOnly, setShowPartnerOnly] = useState(false);

  const tasks = useMemo(
    () => (tasksQ.data ?? []).filter((t) => !showPartnerOnly || t.partner_email),
    [tasksQ.data, showPartnerOnly],
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

  if (tasksQ.isLoading) return <PageSkeleton />;

  const partnerCount = (tasksQ.data ?? []).filter((t) => t.partner_email && t.status !== "done").length;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Tasks"
        subtitle="Drag cards between columns. Assign to staff or delegate to partners."
        action={
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
              <Handshake className="h-3.5 w-3.5" /> Partner tasks {partnerCount > 0 && `(${partnerCount})`}
            </button>
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> New Task
            </Button>
          </div>
        }
      />

      {(tasksQ.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No tasks yet"
            hint="Create tasks for your team or delegate work to external partners."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New Task
              </Button>
            }
          />
        </Card>
      ) : (
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
                                <Handshake className="h-3 w-3" /> partner
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
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="New Task">
        <NewTaskForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
