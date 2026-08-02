// Partner Hub — Asana-style task space for business partners only.
// Employees never see this (UI gate + can_see_partner_tasks RLS in the DB).

import { useMemo, useState, type DragEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  CalendarDays,
  Trophy,
  Zap,
  LayoutList,
  KanbanSquare,
  Pencil,
  Award,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Play,
} from "lucide-react";
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
import { useTasks, useMembers, usePartnerProfiles, useKudos, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { createTask, updateTask, deleteTask } from "@/lib/api/tasks";
import { upsertPartnerProfile, giveKudos } from "@/lib/api/partners";
import { updateOrg } from "@/lib/api/orgs";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus, TaskPriority, OrgMember, PartnerProfile } from "@/lib/api/database.types";

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

const CATEGORIES = ["Social Media", "Marketing", "Tech", "Legal", "Cooking", "Handwerk", "Events", "Sales", "Photography", "Other"];
const EFFORTS = [1, 2, 3, 5, 8];
const KUDO_EMOJIS = ["👏", "🔥", "🌟", "🙌", "💪"];

const PARTNER_ROLES = new Set(["owner", "admin", "partner"]);

function hueFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function nameOf(m: OrgMember | undefined): string {
  return m?.full_name || m?.email || "Unknown";
}

function initialsOf(m: OrgMember | undefined): string {
  const n = nameOf(m);
  return n.split(/[\s@.]+/).filter(Boolean).map((p) => p[0]!.toUpperCase()).join("").slice(0, 2);
}

function VisibilityToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-[11px] text-zinc-500">{label} visible to</span>
      <div className="flex rounded-full border border-line bg-white/[0.03] p-0.5">
        <button
          onClick={() => value && onChange(false)}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
            !value ? "bg-white/10 text-white" : "text-zinc-500 hover:text-white",
          )}
        >
          Admins only
        </button>
        <button
          onClick={() => !value && onChange(true)}
          className={cn(
            "cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
            value ? "bg-amber-soft/15 text-amber-soft" : "text-zinc-500 hover:text-white",
          )}
        >
          Everyone
        </button>
      </div>
    </div>
  );
}

function MemberAvatar({ member, size = "h-6 w-6 text-[10px]" }: { member: OrgMember | undefined; size?: string }) {
  const hue = hueFor(member?.user_id ?? "?");
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-zinc-950", size)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 65%), hsl(${hue + 40} 70% 55%))` }}
      title={nameOf(member)}
    >
      {initialsOf(member)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New partner task
// ---------------------------------------------------------------------------
function NewPartnerTaskForm({ partners, onDone }: { partners: OrgMember[]; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "medium" as TaskPriority,
    assignee: "",
    category: "",
    effort: 1,
    dueDate: "",
  });

  const create = useMutation({
    mutationFn: () =>
      createTask(org!.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        assignee_employee_id: null,
        partner_email: null,
        due_date: form.dueDate || null,
        is_partner_task: true,
        assignee_user_id: form.assignee || null,
        effort: form.effort,
        category: form.category || null,
      }),
    onSuccess: () => {
      invalidate("tasks");
      toast.success("Partner task created", form.title.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not create task", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Renew trade license" autoFocus />
      </Field>
      <Field label="Details (optional)">
        <Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Anything the assignee should know" />
      </Field>
      <Field label="Assign to partner">
        <Select value={form.assignee} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}>
          <option value="">Unassigned</option>
          {partners.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {nameOf(m)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Effort">
          <Select value={String(form.effort)} onChange={(e) => setForm((f) => ({ ...f, effort: Number(e.target.value) }))}>
            {EFFORTS.map((n) => (
              <option key={n} value={n}>{n} point{n > 1 ? "s" : ""}</option>
            ))}
          </Select>
        </Field>
      </div>
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
      <Button className="w-full" disabled={!form.title.trim() || create.isPending} onClick={() => create.mutate()}>
        Create Partner Task
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills profile editor
// ---------------------------------------------------------------------------
function ProfileForm({
  member,
  profile,
  onDone,
}: {
  member: OrgMember;
  profile: PartnerProfile | undefined;
  onDone: () => void;
}) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    focus: profile?.focus ?? "",
    skills: (profile?.skills ?? []).join(", "),
    location: profile?.location ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      upsertPartnerProfile(org!.id, member.user_id, {
        focus: form.focus.trim() || null,
        skills: form.skills.split(",").map((s) => s.trim()).filter(Boolean),
        location: form.location.trim() || null,
      }),
    onSuccess: () => {
      invalidate("partner_profiles");
      toast.success("Profile saved", nameOf(member));
      onDone();
    },
    onError: (e) => toast.error("Could not save profile", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Focus — what do they own?">
        <Input value={form.focus} onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value }))} placeholder="e.g. Tech & Marketing" />
      </Field>
      <Field label="Skills (comma-separated)">
        <Input value={form.skills} onChange={(e) => setForm((f) => ({ ...f, skills: e.target.value }))} placeholder="e.g. Social Media, Legal, Architecture" />
      </Field>
      <Field label="Location / availability note (optional)">
        <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. India — relocating to Germany" />
      </Field>
      <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
        Save Profile
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Give kudos
// ---------------------------------------------------------------------------
function KudosForm({
  partners,
  toUser,
  taskId,
  onDone,
}: {
  partners: OrgMember[];
  toUser?: string;
  taskId?: string | null;
  onDone: () => void;
}) {
  const { org } = useOrg();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ to: toUser ?? "", emoji: "👏", message: "" });

  const send = useMutation({
    mutationFn: () =>
      giveKudos(org!.id, user!.id, {
        to_user: form.to,
        emoji: form.emoji,
        message: form.message.trim(),
        task_id: taskId ?? null,
      }),
    onSuccess: () => {
      invalidate("kudos");
      toast.success("Kudos sent! " + form.emoji);
      onDone();
    },
    onError: (e) => toast.error("Could not send kudos", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="To">
        <Select value={form.to} onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))}>
          <option value="">Pick a partner…</option>
          {partners
            .filter((m) => m.user_id !== user?.id)
            .map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {nameOf(m)}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Emoji">
        <div className="flex gap-2">
          {KUDO_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => setForm((f) => ({ ...f, emoji: e }))}
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2 text-lg transition-all",
                form.emoji === e ? "border-brand-400/60 bg-brand-400/10" : "border-line bg-white/[0.02]",
              )}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Message">
        <Input value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} placeholder="e.g. Amazing job on the popup event!" />
      </Field>
      <Button className="w-full" disabled={!form.to || send.isPending} onClick={() => send.mutate()}>
        Send Kudos {form.emoji}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function PartnerBoard() {
  const { org, isAdmin, refresh } = useOrg();
  const { user } = useAuth();
  const tasksQ = useTasks();
  const membersQ = useMembers();
  const profilesQ = usePartnerProfiles();
  const kudosQ = useKudos();
  const invalidate = useInvalidate();

  const [view, setView] = useState<"board" | "list">("board");
  const [adding, setAdding] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [showHub, setShowHub] = useState(true);
  const [editingProfile, setEditingProfile] = useState<OrgMember | null>(null);
  const [kudosTarget, setKudosTarget] = useState<{ toUser?: string; taskId?: string | null } | null>(null);
  const [filters, setFilters] = useState({ assignee: "", category: "", priority: "", overdue: false, mine: false });

  const members = membersQ.data ?? [];
  const partners = useMemo(() => members.filter((m) => PARTNER_ROLES.has(m.role)), [members]);
  const profiles = profilesQ.data ?? [];
  const kudos = kudosQ.data ?? [];
  const memberById = (id: string | null | undefined) => members.find((m) => m.user_id === id);

  const allPartnerTasks = useMemo(() => (tasksQ.data ?? []).filter((t) => t.is_partner_task), [tasksQ.data]);

  const tasks = useMemo(
    () =>
      allPartnerTasks.filter((t) => {
        if (filters.assignee && t.assignee_user_id !== filters.assignee) return false;
        if (filters.category && t.category !== filters.category) return false;
        if (filters.priority && t.priority !== filters.priority) return false;
        if (filters.mine && t.assignee_user_id !== user?.id) return false;
        if (filters.overdue && !(t.due_date && t.status !== "done" && new Date(t.due_date) < new Date())) return false;
        return true;
      }),
    [allPartnerTasks, filters, user?.id],
  );

  // Recognition data is admin-only unless an admin opts in to showing everyone.
  const potmPublic = org?.settings?.partner_of_month_public === true;
  const numbersPublic = org?.settings?.leaderboard_numbers_public === true;
  const showPotm = isAdmin || potmPublic;
  const showNumbers = isAdmin || numbersPublic;

  // Leaderboard: this calendar month, effort points on done tasks + kudos received.
  // When numbers are hidden from the viewer, sort alphabetically so the order
  // itself doesn't leak the ranking.
  const monthKey = new Date().toISOString().slice(0, 7);
  const leaderboard = useMemo(() => {
    const rows = partners.map((m) => {
      const mine = allPartnerTasks.filter((t) => t.assignee_user_id === m.user_id);
      const doneMonth = mine.filter((t) => t.status === "done" && (t.completed_at ?? "").slice(0, 7) === monthKey);
      return {
        member: m,
        open: mine.filter((t) => t.status !== "done").length,
        doneMonth: doneMonth.length,
        effortMonth: doneMonth.reduce((s, t) => s + (t.effort || 1), 0),
        kudosMonth: kudos.filter((k) => k.to_user === m.user_id && k.created_at.slice(0, 7) === monthKey).length,
      };
    });
    return rows.sort((a, b) =>
      showNumbers
        ? b.effortMonth - a.effortMonth || b.kudosMonth - a.kudosMonth || a.open - b.open
        : nameOf(a.member).localeCompare(nameOf(b.member)),
    );
  }, [partners, allPartnerTasks, kudos, monthKey, showNumbers]);

  const topUserId = useMemo(() => {
    let id: string | null = null;
    let best = 0;
    for (const r of leaderboard) {
      if (r.effortMonth > best) {
        best = r.effortMonth;
        id = r.member.user_id;
      }
    }
    return id;
  }, [leaderboard]);

  const setHubSetting = async (key: string, value: boolean, label: string) => {
    try {
      await updateOrg(org!.id, { settings: { ...(org!.settings ?? {}), [key]: value } });
      refresh();
      toast.success("Setting saved", `${label} is now visible to ${value ? "everyone" : "admins only"}`);
    } catch (e) {
      toast.error("Could not save setting", e instanceof Error ? e.message : "");
    }
  };

  const move = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    try {
      await updateTask(org!.id, task.id, { status, position: Date.now() });
      invalidate("tasks");
      if (status === "done") toast.success("Task completed", `${task.title} · +${task.effort || 1} effort`);
    } catch (e) {
      toast.error("Could not move task", e instanceof Error ? e.message : "");
    }
  };

  const advance = (t: Task) => move(t, t.status === "todo" ? "in_progress" : "done");

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

  if (tasksQ.isLoading || membersQ.isLoading) return <PageSkeleton />;

  const filterPill = (active: boolean) =>
    cn(
      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
      active ? "border-brand-400/40 bg-brand-400/10 text-brand-300" : "border-line bg-white/[0.03] text-zinc-400 hover:text-white",
    );

  const taskCard = (t: Task) => {
    const assignee = memberById(t.assignee_user_id);
    const overdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date();
    return (
      <Card
        key={t.id}
        className={cn("cursor-grab p-4 transition-all active:cursor-grabbing", dragId === t.id && "opacity-40")}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ draggable: true } as any)}
      >
        <div draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}>
          <div className="flex items-start justify-between gap-2">
            <p className={cn("text-sm font-semibold text-white", t.status === "done" && "text-zinc-500 line-through")}>{t.title}</p>
            <div className="flex shrink-0 items-center gap-0.5">
              {t.status === "done" && t.assignee_user_id && t.assignee_user_id !== user?.id && (
                <button
                  onClick={() => setKudosTarget({ toUser: t.assignee_user_id!, taskId: t.id })}
                  className="cursor-pointer rounded p-0.5 text-zinc-600 hover:text-amber-soft"
                  title="Give kudos"
                >
                  <Award className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => remove(t)} className="cursor-pointer rounded p-0.5 text-zinc-600 hover:text-rose-soft">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {t.description && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{t.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Badge tone={priorityTone[t.priority]} className="capitalize">{t.priority}</Badge>
            {t.category && <Badge tone="cyan">{t.category}</Badge>}
            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-soft">
              <Zap className="h-3 w-3" />
              {t.effort || 1}
            </span>
            {assignee && <MemberAvatar member={assignee} size="h-5 w-5 text-[9px]" />}
            {t.due_date && (
              <span className={cn("inline-flex items-center gap-1 text-[11px]", overdue ? "font-semibold text-rose-soft" : "text-zinc-500")}>
                <CalendarDays className="h-3 w-3" />
                {new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <div className="mt-3 flex gap-1 md:hidden">
            {columns
              .filter((c) => c.status !== t.status)
              .map((c) => (
                <button key={c.status} onClick={() => move(t, c.status)} className="flex-1 cursor-pointer rounded-lg border border-line py-1 text-[11px] text-zinc-400">
                  → {c.title}
                </button>
              ))}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      {/* ---- Partner Hub: leaderboard + skills + kudos ---- */}
      <Card className="p-0">
        <button
          onClick={() => setShowHub((v) => !v)}
          className="flex w-full cursor-pointer items-center justify-between p-4"
        >
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-soft" />
            <h3 className="font-semibold text-white">Partner Hub</h3>
            <span className="text-xs text-zinc-500">
              contributions · skills · recognition — {new Date().toLocaleDateString(undefined, { month: "long" })}
            </span>
          </div>
          {showHub ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
        </button>

        {showHub && (
          <div className="space-y-5 border-t border-line p-4">
            {/* Leaderboard */}
            {partners.length === 0 ? (
              <p className="text-sm text-zinc-500">
                No partners yet — invite them in Team &amp; Access with the <span className="font-semibold text-violet-soft">Partner</span> role.
              </p>
            ) : (
              <>
                {isAdmin && (
                  <div className="flex flex-col items-end gap-1.5">
                    <VisibilityToggle
                      label="🏆 Partner of the Month"
                      value={potmPublic}
                      onChange={(v) => setHubSetting("partner_of_month_public", v, "Partner of the Month")}
                    />
                    <VisibilityToggle
                      label="📊 Leaderboard numbers"
                      value={numbersPublic}
                      onChange={(v) => setHubSetting("leaderboard_numbers_public", v, "Leaderboard numbers")}
                    />
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {leaderboard.map((row) => {
                  const profile = profiles.find((p) => p.user_id === row.member.user_id);
                  const isTop = showPotm && row.member.user_id === topUserId;
                  const canEdit = row.member.user_id === user?.id || isAdmin;
                  return (
                    <div
                      key={row.member.user_id}
                      className={cn(
                        "rounded-2xl border p-3 transition-all",
                        isTop ? "border-amber-soft/40 bg-amber-soft/5" : "border-line bg-white/[0.02]",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <MemberAvatar member={row.member} size="h-9 w-9 text-xs" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">
                            {nameOf(row.member)}
                            {isTop && <span title="Partner of the Month"> 🏆</span>}
                          </p>
                          <p className="truncate text-[11px] text-zinc-500">
                            {profile?.focus || row.member.role}
                            {profile?.location ? ` · ${profile.location}` : ""}
                          </p>
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => setEditingProfile(row.member)}
                            className="cursor-pointer rounded p-1 text-zinc-600 hover:text-white"
                            title="Edit skills profile"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {(profile?.skills ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {profile!.skills.slice(0, 4).map((s) => (
                            <span key={s} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
                              {s}
                            </span>
                          ))}
                          {profile!.skills.length > 4 && (
                            <span className="text-[10px] text-zinc-600">+{profile!.skills.length - 4}</span>
                          )}
                        </div>
                      )}
                      {showNumbers && (
                        <div className="mt-2.5 grid grid-cols-3 gap-1 text-center">
                          <div>
                            <p className="font-display text-sm font-bold text-white">{row.open}</p>
                            <p className="text-[10px] text-zinc-500">open</p>
                          </div>
                          <div>
                            <p className="font-display text-sm font-bold text-violet-soft">
                              <Zap className="mr-0.5 inline h-3 w-3" />
                              {row.effortMonth}
                            </p>
                            <p className="text-[10px] text-zinc-500">effort</p>
                          </div>
                          <div>
                            <p className="font-display text-sm font-bold text-amber-soft">{row.kudosMonth}</p>
                            <p className="text-[10px] text-zinc-500">kudos</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                </div>
              </>
            )}

            {/* Kudos feed */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Recent kudos</p>
                <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setKudosTarget({})}>
                  <Award className="h-3.5 w-3.5" /> Give kudos
                </Button>
              </div>
              {kudos.length === 0 ? (
                <p className="text-xs text-zinc-600">No kudos yet — celebrate a partner's work with the first one!</p>
              ) : (
                <div className="space-y-1.5">
                  {kudos.slice(0, 6).map((k) => (
                    <div key={k.id} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="text-base">{k.emoji}</span>
                      <p className="min-w-0 flex-1 truncate text-zinc-300">
                        <span className="font-semibold text-white">{nameOf(memberById(k.from_user))}</span>
                        {" → "}
                        <span className="font-semibold text-white">{nameOf(memberById(k.to_user))}</span>
                        {k.message && <span className="text-zinc-400"> — {k.message}</span>}
                      </p>
                      <span className="shrink-0 text-[11px] text-zinc-600">
                        {new Date(k.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ---- Toolbar: view toggle + filters + new task ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line bg-white/[0.03] p-0.5">
          <button onClick={() => setView("board")} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold", view === "board" ? "bg-white/10 text-white" : "text-zinc-500")}>
            <KanbanSquare className="h-3.5 w-3.5" /> Board
          </button>
          <button onClick={() => setView("list")} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold", view === "list" ? "bg-white/10 text-white" : "text-zinc-500")}>
            <LayoutList className="h-3.5 w-3.5" /> List
          </button>
        </div>

        <Select value={filters.assignee} onChange={(e) => setFilters((f) => ({ ...f, assignee: e.target.value }))} className="w-36 py-1.5 text-xs">
          <option value="">All partners</option>
          {partners.map((m) => (
            <option key={m.user_id} value={m.user_id}>{nameOf(m)}</option>
          ))}
        </Select>
        <Select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="w-32 py-1.5 text-xs">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} className="w-28 py-1.5 text-xs">
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <button onClick={() => setFilters((f) => ({ ...f, overdue: !f.overdue }))} className={filterPill(filters.overdue)}>
          Overdue
        </button>
        <button onClick={() => setFilters((f) => ({ ...f, mine: !f.mine }))} className={filterPill(filters.mine)}>
          My tasks
        </button>

        <div className="ml-auto">
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Task
          </Button>
        </div>
      </div>

      {/* ---- Tasks ---- */}
      {allPartnerTasks.length === 0 ? (
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No partner tasks yet"
            hint="Create tasks and assign them to each other — employees never see this board."
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
            const colTasks = tasks.filter((t) => t.status === col.status).sort((a, b) => a.position - b.position);
            return (
              <div
                key={col.status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverCol(col.status);
                }}
                onDragLeave={() => setOverCol(null)}
                onDrop={(e) => onDrop(e, col.status)}
                className={cn("space-y-3 rounded-2xl p-2 transition-all", overCol === col.status && "bg-white/[0.03] ring-1 ring-brand-400/30")}
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.tone }} />
                  <h3 className="font-semibold text-white">{col.title}</h3>
                  <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs font-bold text-zinc-400">{colTasks.length}</span>
                </div>
                {colTasks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-zinc-600">Drop tasks here</div>
                ) : (
                  colTasks.map(taskCard)
                )}
              </div>
            );
          })}
        </div>
      ) : (
        // ---- List view: grouped by assignee ----
        <div className="space-y-4">
          {[...partners.map((m) => ({ key: m.user_id, member: m as OrgMember | undefined })), { key: "", member: undefined }].map(({ key, member }) => {
            const rows = tasks
              .filter((t) => (key ? t.assignee_user_id === key : !t.assignee_user_id))
              .sort((a, b) => (a.status === b.status ? a.position - b.position : a.status === "done" ? 1 : b.status === "done" ? -1 : 0));
            if (rows.length === 0) return null;
            return (
              <Card key={key || "unassigned"} className="p-0">
                <div className="flex items-center gap-2.5 border-b border-line p-3">
                  {member ? <MemberAvatar member={member} size="h-7 w-7 text-[10px]" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 text-[10px] font-bold text-zinc-500">—</span>}
                  <p className="font-semibold text-white">{member ? nameOf(member) : "Unassigned"}</p>
                  <span className="ml-auto text-xs text-zinc-500">
                    {rows.filter((t) => t.status !== "done").length} open
                  </span>
                </div>
                <div className="divide-y divide-line/60">
                  {rows.map((t) => {
                    const overdue = t.due_date && t.status !== "done" && new Date(t.due_date) < new Date();
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: columns.find((c) => c.status === t.status)?.tone }} />
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm font-medium text-white", t.status === "done" && "text-zinc-500 line-through")}>{t.title}</p>
                          <p className="text-[11px] text-zinc-500">
                            {t.category ?? "General"} · <Zap className="inline h-2.5 w-2.5 text-violet-soft" /> {t.effort || 1}
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
                            {t.status === "todo" ? <><Play className="h-3 w-3" /> Start</> : <><CheckCircle2 className="h-3 w-3" /> Done</>}
                          </Button>
                        ) : (
                          <button onClick={() => remove(t)} className="shrink-0 cursor-pointer rounded p-1 text-zinc-600 hover:text-rose-soft">
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

      {/* ---- Modals ---- */}
      <Modal open={adding} onClose={() => setAdding(false)} title="New Partner Task">
        <NewPartnerTaskForm partners={partners} onDone={() => setAdding(false)} />
      </Modal>

      <Modal
        open={!!editingProfile}
        onClose={() => setEditingProfile(null)}
        title={`Skills profile — ${editingProfile ? nameOf(editingProfile) : ""}`}
      >
        {editingProfile && (
          <ProfileForm
            member={editingProfile}
            profile={profiles.find((p) => p.user_id === editingProfile.user_id)}
            onDone={() => setEditingProfile(null)}
          />
        )}
      </Modal>

      <Modal open={!!kudosTarget} onClose={() => setKudosTarget(null)} title="Give Kudos">
        {kudosTarget && (
          <KudosForm partners={partners} toUser={kudosTarget.toUser} taskId={kudosTarget.taskId} onDone={() => setKudosTarget(null)} />
        )}
      </Modal>
    </div>
  );
}
