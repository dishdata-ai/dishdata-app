"use client";

import { useState, useMemo, useRef } from "react";
import { CheckCircle2, Circle, ChevronDown, Link2, Square, CheckSquare, Plus, Pencil, X, Users, Camera, Loader2 } from "lucide-react";
import { Card, Badge, Button, EmptyState, PageSkeleton, Modal, Field, Input, Textarea, Select } from "@/components/ui";
import { useTasks, useEmployees, useMembers, useDuties, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { createTask, updateTask } from "@/lib/api/tasks";
import { DUTY_ROLES, DUTY_LABELS, addDuty, removeDuty, myDuties } from "@/lib/api/duties";
import { isDoneToday, stepsToday, proofToday, recentProof, photoProofOn } from "@/lib/daily";
import { uploadOrgAsset } from "@/lib/api/orgs";
import TaskDetail from "@/views/TaskDetail";
import { toast } from "@/lib/toast";
import { cn, uid } from "@/lib/utils";
import type { Task, StaffRole, TaskPriority, DutyAssignment, Employee, OrgMember } from "@/lib/api/database.types";

type Tone = "green" | "amber" | "rose" | "violet" | "cyan" | "neutral";

const ROLE_ORDER: (StaffRole | null)[] = [
  "frontend",
  "frontend_helper",
  "kitchen_lead",
  "commi_kitchen",
  "kitchen_helper",
  "manager",
  "admin",
  "owner",
  null,
];

const ROLE_TONES: Record<StaffRole, Tone> = {
  frontend: "cyan",
  frontend_helper: "green",
  kitchen_lead: "amber",
  commi_kitchen: "violet",
  kitchen_helper: "rose",
  owner: "rose",
  admin: "rose",
  manager: "amber",
};

const roleLabel = (r: StaffRole | null) => (r ? DUTY_LABELS[r] : "Unassigned — decide who later");
const roleTone = (r: StaffRole | null): Tone => (r ? ROLE_TONES[r] : "neutral");

const isImageUrl = (url: string) => /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(url);

/** Daily-checklists view, mounted as a tab inside Tasks (src/views/Tasks.tsx). */
export default function DailyBoard() {
  const { org, isManager } = useOrg();
  const photosOn = photoProofOn(org);
  const { user } = useAuth();
  const tasksQ = useTasks();
  const employeesQ = useEmployees();
  const membersQ = useMembers();
  const dutiesQ = useDuties();
  const invalidate = useInvalidate();

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"mine" | "all" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const employees = useMemo(() => (employeesQ.data ?? []).filter((e) => e.is_active), [employeesQ.data]);
  const duties = useMemo(() => dutiesQ.data ?? [], [dutiesQ.data]);
  const me = employees.find((e) => e.user_id === user?.id) ?? null;
  const mine = useMemo(() => myDuties(duties, me, user?.id), [duties, me, user?.id]);

  // Everyone starts on their own duties; anyone can flip to "Everyone" to help out.
  const effectiveView = view ?? (mine.size > 0 ? "mine" : "all");

  const personName = (d: { employee_id: string | null; user_id: string | null }) => {
    if (d.employee_id) return employees.find((e) => e.id === d.employee_id)?.name ?? "Former staff";
    const linked = employees.find((e) => e.user_id === d.user_id);
    if (linked) return linked.name;
    const m = (membersQ.data ?? []).find((x) => x.user_id === d.user_id);
    return m?.full_name || m?.email || "Team member";
  };

  const groups = useMemo(() => {
    const daily = (tasksQ.data ?? []).filter((t) => t.is_daily && !t.is_partner_task);
    return ROLE_ORDER.map((role) => ({
      role,
      tasks: daily.filter((t) => t.assigned_role === role).sort((a, b) => a.position - b.position),
    })).filter((g) => g.tasks.length > 0 && (effectiveView === "all" || g.role === null || (g.role && mine.has(g.role))));
  }, [tasksQ.data, effectiveView, mine]);

  const save = async (task: Task, patch: Partial<Task>) => {
    try {
      await updateTask(org!.id, task.id, patch);
      invalidate("tasks");
    } catch (e) {
      toast.error("Could not update task", e instanceof Error ? e.message : "");
    }
  };

  const addPhoto = async (task: Task, file: File, kind: "proof" | "example") => {
    setUploading(`${kind}:${task.id}`);
    try {
      const url = await uploadOrgAsset(org!.id, file, `daily/${task.id}/${kind}-${Date.now()}.webp`, 1280);
      if (kind === "example") {
        await updateTask(org!.id, task.id, { example_photo_url: url });
      } else {
        const photo = { id: uid(), url, by: me?.name ?? user?.email ?? null, at: new Date().toISOString() };
        await updateTask(org!.id, task.id, { proof_photos: [...recentProof(task), photo] });
      }
      invalidate("tasks");
      toast.success(kind === "proof" ? "Photo added" : "Example photo saved", task.title);
    } catch (e) {
      toast.error("Could not upload photo", e instanceof Error ? e.message : "");
    } finally {
      setUploading(null);
    }
  };

  const removeProof = (task: Task, photoId: string) =>
    save(task, { proof_photos: (task.proof_photos ?? []).filter((p) => p.id !== photoId) });

  const toggleTask = (task: Task) => {
    const done = !isDoneToday(task);
    if (done && photosOn && task.requires_photo && proofToday(task).length === 0) {
      setOpen((prev) => new Set(prev).add(task.id));
      toast.info("Photo needed", "Add a photo of your finished work, then tick it off.");
      return;
    }
    save(task, {
      status: done ? "done" : "todo",
      completed_at: new Date().toISOString(),
      checklist: stepsToday(task).map((c) => ({ ...c, done })),
    });
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

  const editing = (tasksQ.data ?? []).find((t) => t.id === editId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-zinc-400">
          Checklists that reset every day. Everyone starts on their own duties — switch to Everyone to see who needs a hand.
        </p>
        <div className="flex items-center gap-2">
          {mine.size > 0 && (
            <div className="flex rounded-full border border-line bg-white/[0.03] p-0.5 text-xs font-semibold">
              {(["mine", "all"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1 transition-colors",
                    effectiveView === v ? "bg-brand-400/15 text-brand-300" : "text-zinc-400 hover:text-white",
                  )}
                >
                  {v === "mine" ? "My duties" : "Everyone"}
                </button>
              ))}
            </div>
          )}
          {isManager && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> New daily task
            </Button>
          )}
        </div>
      </div>

      <DutyBoard
        orgId={org!.id}
        canEdit={isManager}
        duties={duties}
        employees={employees}
        members={membersQ.data ?? []}
        personName={personName}
        onChange={() => invalidate("duty_assignments")}
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={effectiveView === "mine" ? "Nothing on your duties" : "No daily tasks yet"}
          hint={effectiveView === "mine" ? "Switch to Everyone to see the whole team's checklists." : "Managers can add daily tasks here."}
        />
      ) : (
        <div className="space-y-4">
          {groups.map(({ role, tasks }) => {
            const done = tasks.filter(isDoneToday).length;
            return (
              <Card key={role ?? "unassigned"} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={roleTone(role)}>{roleLabel(role)}</Badge>
                    <span className="text-sm text-zinc-400">
                      {done} / {tasks.length} done today
                    </span>
                  </div>
                  <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-brand-400 transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
                  </div>
                </div>

                <div className="divide-y divide-line/60">
                  {tasks.map((task) => {
                    const steps = stepsToday(task);
                    const links = task.links ?? [];
                    const proof = proofToday(task);
                    const needsPhoto = photosOn && task.requires_photo;
                    const expandable = steps.length > 0 || links.length > 0 || (photosOn && !!task.example_photo_url) || needsPhoto;
                    const expanded = open.has(task.id);
                    const finished = isDoneToday(task);
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
                            {needsPhoto && (
                              <span
                                className={cn(
                                  "mt-1 inline-flex items-center gap-1 text-xs",
                                  proof.length > 0 ? "text-brand-300" : "text-amber-soft",
                                )}
                              >
                                <Camera className="h-3 w-3" />
                                {proof.length > 0 ? `${proof.length} photo${proof.length > 1 ? "s" : ""} today` : "Photo of the finished work needed"}
                              </span>
                            )}
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
                              <div className="mt-2 space-y-3">
                                {photosOn && (task.example_photo_url || task.requires_photo) && (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <p className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">How it should look</p>
                                      {task.example_photo_url ? (
                                        <a href={task.example_photo_url} target="_blank" rel="noreferrer">
                                          <img src={task.example_photo_url} alt="Example" className="max-h-44 rounded-lg ring-1 ring-white/10" />
                                        </a>
                                      ) : (
                                        <p className="text-xs text-zinc-500">
                                          No example yet{isManager ? " — add one via the pencil." : "."}
                                        </p>
                                      )}
                                    </div>
                                    <div>
                                      <p className="mb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Your work today</p>
                                      <div className="flex flex-wrap items-start gap-2">
                                        {proof.map((ph) => (
                                          <div key={ph.id} className="group relative">
                                            <a href={ph.url} target="_blank" rel="noreferrer">
                                              <img src={ph.url} alt="Finished work" className="h-24 rounded-lg ring-1 ring-white/10" />
                                            </a>
                                            <span className="mt-0.5 block text-[10px] text-zinc-500">
                                              {ph.by ?? "Someone"} · {new Date(ph.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                            </span>
                                            <button
                                              onClick={() => removeProof(task, ph.id)}
                                              aria-label="Remove photo"
                                              className="absolute top-1 right-1 hidden cursor-pointer rounded-full bg-black/70 p-0.5 text-white group-hover:block"
                                            >
                                              <X className="h-3 w-3" />
                                            </button>
                                          </div>
                                        ))}
                                        <PhotoButton
                                          busy={uploading === `proof:${task.id}`}
                                          label={proof.length ? "Add another" : "Add photo"}
                                          onFile={(f) => addPhoto(task, f, "proof")}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                )}
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
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge tone={task.priority === "high" ? "rose" : task.priority === "medium" ? "amber" : "neutral"}>
                              {task.priority}
                            </Badge>
                            {isManager && (
                              <button
                                onClick={() => setEditId(task.id)}
                                aria-label="Edit task"
                                className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
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

      <Modal open={adding} onClose={() => setAdding(false)} title="New daily task">
        <NewDailyForm orgId={org!.id} photosOn={photosOn} onDone={() => setAdding(false)} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditId(null)} title="Edit daily task" wide>
        {editing && (
          <div className="space-y-5">
            <Field label="Duty — who this belongs to">
              <Select
                value={editing.assigned_role ?? ""}
                onChange={(e) => save(editing, { assigned_role: (e.target.value || null) as StaffRole | null })}
              >
                <option value="">Unassigned — decide later</option>
                {DUTY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {DUTY_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            {photosOn && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Example photo — how it should look">
                <div className="flex items-start gap-3">
                  {editing.example_photo_url && (
                    <img src={editing.example_photo_url} alt="Example" className="h-20 rounded-lg ring-1 ring-white/10" />
                  )}
                  <div className="space-y-2">
                    <PhotoButton
                      busy={uploading === `example:${editing.id}`}
                      label={editing.example_photo_url ? "Replace" : "Upload example"}
                      onFile={(f) => addPhoto(editing, f, "example")}
                    />
                    {editing.example_photo_url && (
                      <button
                        onClick={() => save(editing, { example_photo_url: null })}
                        className="block cursor-pointer text-xs text-zinc-500 hover:text-rose-soft"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </Field>
              <Field label="Photo proof">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={editing.requires_photo}
                    onChange={(e) => save(editing, { requires_photo: e.target.checked })}
                    className="h-4 w-4 accent-brand-400"
                  />
                  Must attach a photo of the finished work
                </label>
              </Field>
            </div>
            )}
            <TaskDetail
              task={editing}
              assignees={employees.map((e) => ({ id: e.id, name: e.name, hue: e.avatar_hue }))}
              assigneeField="assignee_employee_id"
              assigneeLabel="Assigned employee"
              showEffort={false}
              onClose={() => setEditId(null)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

function DutyBoard({
  orgId,
  canEdit,
  duties,
  employees,
  members,
  personName,
  onChange,
}: {
  orgId: string;
  canEdit: boolean;
  duties: DutyAssignment[];
  employees: Employee[];
  members: OrgMember[];
  personName: (d: { employee_id: string | null; user_id: string | null }) => string;
  onChange: () => void;
}) {
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onChange();
    } catch (e) {
      toast.error("Could not update duty", e instanceof Error ? e.message : "");
    }
  };

  // Staff (employee rows) plus partners/managers who have a login but no staff record.
  const linkedUserIds = new Set(employees.map((e) => e.user_id).filter(Boolean));
  const options = [
    ...employees.map((e) => ({ value: `e:${e.id}`, label: `${e.name} · ${e.role_title}` })),
    ...members
      .filter((m) => ["partner", "manager", "admin", "owner"].includes(m.role) && !linkedUserIds.has(m.user_id))
      .map((m) => ({ value: `u:${m.user_id}`, label: `${m.full_name || m.email || "Member"} · ${m.role}` })),
  ];

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <Users className="h-4 w-4 text-zinc-400" /> Who does what
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {DUTY_ROLES.map((duty) => {
          const holders = duties.filter((d) => d.duty === duty);
          const taken = new Set(holders.map((d) => d.employee_id ?? d.user_id));
          const free = options.filter((o) => !taken.has(o.value.slice(2)));
          return (
            <div key={duty} className="space-y-2">
              <Badge tone={ROLE_TONES[duty]}>{DUTY_LABELS[duty]}</Badge>
              <div className="flex flex-wrap gap-1.5">
                {holders.length === 0 && <span className="text-xs text-zinc-500">Nobody yet</span>}
                {holders.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pr-1 pl-2.5 text-xs text-zinc-200"
                  >
                    {personName(d)}
                    {canEdit && (
                      <button
                        onClick={() => run(() => removeDuty(orgId, d.id))}
                        aria-label={`Remove ${personName(d)}`}
                        className="cursor-pointer rounded-full p-0.5 text-zinc-500 hover:text-rose-soft"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {canEdit && free.length > 0 && (
                <Select
                  value=""
                  aria-label={`Add someone to ${DUTY_LABELS[duty]}`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    run(() => addDuty(orgId, duty, v.startsWith("e:") ? { employee_id: v.slice(2) } : { user_id: v.slice(2) }));
                  }}
                >
                  <option value="">+ Add person…</option>
                  {free.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function NewDailyForm({ orgId, photosOn, onDone }: { orgId: string; photosOn: boolean; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" as TaskPriority, duty: "" as StaffRole | "", photo: false });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await createTask(orgId, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        assignee_employee_id: null,
        partner_email: null,
        due_date: null,
        assigned_role: form.duty || null,
        is_daily: true,
        requires_photo: form.photo,
        department:
          form.duty === "kitchen_lead" || form.duty === "commi_kitchen" || form.duty === "kitchen_helper"
            ? "kitchen"
            : form.duty === "frontend" || form.duty === "frontend_helper"
              ? "front_of_house"
              : null,
      });
      invalidate("tasks");
      toast.success("Daily task added", form.title.trim());
      onDone();
    } catch (e) {
      toast.error("Could not add task", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Refill napkin dispensers" autoFocus />
      </Field>
      <Field label="Details (optional)">
        <Textarea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Duty">
          <Select value={form.duty} onChange={(e) => setForm((f) => ({ ...f, duty: e.target.value as StaffRole | "" }))}>
            <option value="">Unassigned — decide later</option>
            {DUTY_ROLES.map((r) => (
              <option key={r} value={r}>
                {DUTY_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TaskPriority }))}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>
      </div>
      {photosOn && (
      <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={form.photo}
          onChange={(e) => setForm((f) => ({ ...f, photo: e.target.checked }))}
          className="h-4 w-4 accent-brand-400"
        />
        Must attach a photo of the finished work
      </label>
      )}
      <Button className="w-full" disabled={!form.title.trim() || saving} onClick={submit}>
        Add daily task
      </Button>
    </div>
  );
}

function PhotoButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
        {label}
      </button>
    </>
  );
}
