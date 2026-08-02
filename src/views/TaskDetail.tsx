// Asana-style task detail panel, shared by the Team board and the Partner board.
// Opens on card click: full editing, notes with clickable links, attached links,
// subtask checklist and a comment thread.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trash2,
  Plus,
  Link2,
  ExternalLink,
  MessageSquare,
  ListChecks,
  Send,
  Copy,
  CalendarDays,
  Zap,
} from "lucide-react";
import { Button, Badge, Input, Textarea, Select, Field, LinkedText } from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { useMembers, useInvalidate } from "@/lib/hooks/data";
import { updateTask, listComments, addComment, deleteComment } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn, uid } from "@/lib/utils";
import type {
  Task,
  TaskStatus,
  TaskPriority,
  ChecklistItem,
  TaskLink,
} from "@/lib/api/database.types";

export interface TaskAssignee {
  id: string;
  name: string;
  hue: number;
}

const STATUSES: { value: TaskStatus; label: string; tone: string }[] = [
  { value: "todo", label: "To Do", tone: "#22d3ee" },
  { value: "in_progress", label: "In Progress", tone: "#fbbf24" },
  { value: "done", label: "Done", tone: "#34d399" },
];

const CATEGORIES = ["Social Media", "Marketing", "Tech", "Legal", "Cooking", "Handwerk", "Events", "Sales", "Photography", "Other"];
const EFFORTS = [1, 2, 3, 5, 8];

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function TaskDetail({
  task,
  assignees,
  assigneeField,
  assigneeLabel,
  showEffort,
  onClose,
}: {
  task: Task;
  assignees: TaskAssignee[];
  assigneeField: "assignee_employee_id" | "assignee_user_id";
  assigneeLabel: string;
  showEffort: boolean;
  onClose: () => void;
}) {
  const { org } = useOrg();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const membersQ = useMembers();

  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.description ?? "");
  const [newItem, setNewItem] = useState("");
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const checklist = useMemo(() => task.checklist ?? [], [task.checklist]);
  const links = useMemo(() => task.links ?? [], [task.links]);
  const dirty = title.trim() !== task.title || notes !== (task.description ?? "");

  const commentsQ = useQuery({
    queryKey: ["org", org?.id, "task_comments", task.id],
    queryFn: () => listComments(org!.id, task.id),
    enabled: !!org,
  });
  const comments = commentsQ.data ?? [];

  const authorName = (id: string) => {
    const m = (membersQ.data ?? []).find((x) => x.user_id === id);
    return m?.full_name || m?.email || "Teammate";
  };

  const patch = async (fields: Partial<Task>, successMsg?: string) => {
    setSaving(true);
    try {
      await updateTask(org!.id, task.id, fields);
      invalidate("tasks");
      if (successMsg) toast.success(successMsg);
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const saveText = () => {
    if (!title.trim()) return;
    patch({ title: title.trim(), description: notes.trim() || null }, "Task updated");
  };

  const setChecklist = (next: ChecklistItem[]) => patch({ checklist: next });
  const setLinks = (next: TaskLink[]) => patch({ links: next });

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setChecklist([...checklist, { id: uid(), text, done: false }]);
    setNewItem("");
  };

  const addLink = () => {
    const url = normalizeUrl(newLink.url);
    if (!url) return;
    setLinks([...links, { id: uid(), label: newLink.label.trim() || url, url }]);
    setNewLink({ label: "", url: "" });
  };

  const postComment = async () => {
    const body = comment.trim();
    if (!body) return;
    try {
      await addComment(org!.id, task.id, user!.id, body);
      setComment("");
      commentsQ.refetch();
    } catch (e) {
      toast.error("Could not post comment", e instanceof Error ? e.message : "");
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/tasks?task=${task.id}`;
    navigator.clipboard?.writeText(url);
    toast.success("Task link copied", "Share it with the team");
  };

  const doneCount = checklist.filter((c) => c.done).length;
  const overdue = task.due_date && task.status !== "done" && new Date(task.due_date) < new Date();

  return (
    <div className="space-y-5">
      {/* Title + notes */}
      <div className="space-y-3">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-base font-semibold"
          placeholder="Task title"
        />
        <div>
          <span className="mb-1.5 block text-xs font-medium text-zinc-400">
            Notes — paste links and they become clickable
          </span>
          <Textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={"Context, steps, links…\nhttps://drive.google.com/…"}
          />
          {notes.trim() && (
            <div className="mt-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-zinc-400">
              <LinkedText text={notes} />
            </div>
          )}
        </div>
        {dirty && (
          <div className="flex gap-2">
            <Button disabled={!title.trim() || saving} onClick={saveText}>
              Save changes
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setTitle(task.title);
                setNotes(task.description ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() =>
              task.status !== s.value &&
              patch(
                { status: s.value, position: Date.now() },
                s.value === "done" ? "Task completed" : undefined,
              )
            }
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
              task.status === s.value
                ? "border-white/20 bg-white/10 text-white"
                : "border-line bg-white/[0.02] text-zinc-500 hover:text-white",
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: s.tone }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Attributes */}
      <div className="grid grid-cols-2 gap-3">
        <Field label={assigneeLabel}>
          <Select
            value={(task[assigneeField] as string | null) ?? ""}
            onChange={(e) => patch({ [assigneeField]: e.target.value || null } as Partial<Task>)}
          >
            <option value="">Unassigned</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority">
          <Select
            value={task.priority}
            onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </Field>
        <Field label="Category">
          <Select value={task.category ?? ""} onChange={(e) => patch({ category: e.target.value || null })}>
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {showEffort ? (
          <Field label="Effort">
            <Select value={String(task.effort || 1)} onChange={(e) => patch({ effort: Number(e.target.value) })}>
              {EFFORTS.map((n) => (
                <option key={n} value={n}>
                  {n} point{n > 1 ? "s" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Due date">
            <Input type="date" value={task.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
          </Field>
        )}
      </div>
      {showEffort && (
        <Field label="Due date">
          <Input type="date" value={task.due_date ?? ""} onChange={(e) => patch({ due_date: e.target.value || null })} />
        </Field>
      )}
      {(overdue || task.due_date) && (
        <p className={cn("flex items-center gap-1.5 text-xs", overdue ? "font-semibold text-rose-soft" : "text-zinc-500")}>
          <CalendarDays className="h-3.5 w-3.5" />
          {overdue ? "Overdue — due " : "Due "}
          {new Date(task.due_date!).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {showEffort && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-violet-soft">
              <Zap className="h-3 w-3" /> {task.effort || 1} effort
            </span>
          )}
        </p>
      )}

      {/* Subtasks */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-zinc-500" />
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Subtasks</p>
          {checklist.length > 0 && (
            <Badge tone={doneCount === checklist.length ? "green" : "neutral"}>
              {doneCount}/{checklist.length}
            </Badge>
          )}
        </div>
        {checklist.length > 0 && (
          <div className="mb-2 space-y-1">
            {checklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={() =>
                    setChecklist(checklist.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)))
                  }
                  className="h-4 w-4 shrink-0 cursor-pointer accent-brand-400"
                />
                <span className={cn("min-w-0 flex-1 text-sm", item.done ? "text-zinc-600 line-through" : "text-zinc-200")}>
                  {item.text}
                </span>
                <button
                  onClick={() => setChecklist(checklist.filter((c) => c.id !== item.id))}
                  className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-600 hover:text-rose-soft"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="Add a subtask…"
          />
          <Button variant="ghost" disabled={!newItem.trim()} onClick={addItem}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Links */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-zinc-500" />
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">Links</p>
        </div>
        {links.length > 0 && (
          <div className="mb-2 space-y-1">
            {links.map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2">
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-accent-400" />
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 flex-1 truncate text-sm text-accent-400 hover:underline"
                  title={l.url}
                >
                  {l.label}
                </a>
                <button
                  onClick={() => setLinks(links.filter((x) => x.id !== l.id))}
                  className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-600 hover:text-rose-soft"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <Input
            value={newLink.label}
            onChange={(e) => setNewLink((f) => ({ ...f, label: e.target.value }))}
            placeholder="Label"
          />
          <Input
            value={newLink.url}
            onChange={(e) => setNewLink((f) => ({ ...f, url: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
            placeholder="paste a URL…"
          />
          <Button variant="ghost" disabled={!newLink.url.trim()} onClick={addLink}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Comments */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-500" />
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            Comments {comments.length > 0 && `(${comments.length})`}
          </p>
        </div>
        {comments.length > 0 && (
          <div className="mb-2 space-y-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">{authorName(c.author)}</span>
                  <span className="text-[11px] text-zinc-600">
                    {new Date(c.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {c.author === user?.id && (
                    <button
                      onClick={async () => {
                        await deleteComment(org!.id, c.id);
                        commentsQ.refetch();
                      }}
                      className="ml-auto cursor-pointer rounded p-0.5 text-zinc-600 hover:text-rose-soft"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <LinkedText text={c.body} className="text-sm text-zinc-300" />
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && postComment()}
            placeholder="Write a comment…"
          />
          <Button disabled={!comment.trim()} onClick={postComment}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-3">
        <button
          onClick={copyLink}
          className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500 hover:text-white"
        >
          <Copy className="h-3.5 w-3.5" /> Copy task link
        </button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
