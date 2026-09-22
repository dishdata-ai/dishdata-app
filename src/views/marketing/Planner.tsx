"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Lightbulb, Target, CheckCircle2, Pencil } from "lucide-react";
import { Card, Badge, Button, Modal, Field, Input, Select, Textarea } from "@/components/ui";
import { useSocialPosts, useSocialTargets, useMembers, useOrders, useKitchenDishes, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { PLATFORMS, platformInfo, createPost, updatePost, deletePost, saveTarget, type NewPost } from "@/lib/api/social";
import { dayKey, weekDays, weekLabel } from "@/lib/api/availability";
import { suggest, type IdeaDraft } from "@/lib/social-ideas";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { OrgMember, SocialFormat, SocialPlatform, SocialPost, SocialStatus, SocialTarget } from "@/lib/api/database.types";

const STATUSES: { id: SocialStatus; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "drafted", label: "Drafted" },
  { id: "scheduled", label: "Scheduled" },
  { id: "posted", label: "Posted" },
];
const FORMATS: SocialFormat[] = ["post", "reel", "story", "video"];
const STATUS_TONE = { idea: "neutral", drafted: "amber", scheduled: "cyan", posted: "green" } as const;

const firstName = (m: Pick<OrgMember, "full_name" | "email">) => (m.full_name || m.email || "Member").split(/[ @]/)[0];

type Draft = Omit<NewPost, "scheduled_for"> & { id?: string; scheduled_for: string };

const blank = (over: Partial<Draft> = {}): Draft => ({
  title: "", caption: "", platform: "instagram", format: "post", status: "idea", scheduled_for: "", owner_user_id: null, link: null, ...over,
});

export default function Planner() {
  const { org, isManager, isPartner } = useOrg();
  const { user } = useAuth();
  const invalidate = useInvalidate();
  const postsQ = useSocialPosts();
  const targetsQ = useSocialTargets();
  const membersQ = useMembers();
  const ordersQ = useOrders();
  const dishesQ = useKitchenDishes();

  const canEdit = isManager || isPartner;
  const [offset, setOffset] = useState(0);
  const [mineOnly, setMineOnly] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingTargets, setEditingTargets] = useState(false);

  const posts = useMemo(() => postsQ.data ?? [], [postsQ.data]);
  const targets = useMemo(() => targetsQ.data ?? [], [targetsQ.data]);
  const members = useMemo(() => (membersQ.data ?? []).filter((m) => ["owner", "admin", "partner", "manager"].includes(m.role)), [membersQ.data]);
  const days = useMemo(() => weekDays(offset), [offset]);
  const keys = days.map(dayKey);
  const today = dayKey(new Date());
  const owner = (id: string | null) => members.find((m) => m.user_id === id);

  const visible = useMemo(() => posts.filter((p) => !mineOnly || p.owner_user_id === user?.id), [posts, mineOnly, user?.id]);
  const byDay = (k: string) => visible.filter((p) => p.scheduled_for === k);
  const tray = visible.filter((p) => !p.scheduled_for && p.status !== "posted");

  const suggestions = useMemo(
    () => suggest({ posts, targets, orders: ordersQ.data ?? [], dishes: dishesQ.data ?? [], weekDays: weekDays(0) }),
    [posts, targets, ordersQ.data, dishesQ.data],
  );

  const weekCount = (platform: SocialPlatform) =>
    posts.filter((p) => p.platform === platform && p.scheduled_for && keys.includes(p.scheduled_for) && (p.status === "scheduled" || p.status === "posted")).length;

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    const { id, scheduled_for, ...rest } = draft;
    const input: NewPost = { ...rest, title: rest.title.trim(), scheduled_for: scheduled_for || null };
    try {
      if (id) await updatePost(org!.id, id, input);
      else await createPost(org!.id, input);
      invalidate("social_posts");
      toast.success(id ? "Post updated" : "Post added", input.title);
      setDraft(null);
    } catch (e) {
      toast.error("Could not save post", e instanceof Error ? e.message : "");
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    try {
      await deletePost(org!.id, draft.id);
      invalidate("social_posts");
      setDraft(null);
    } catch (e) {
      toast.error("Could not delete", e instanceof Error ? e.message : "");
    }
  };

  const addIdea = async (idea: IdeaDraft) => {
    try {
      await createPost(org!.id, { title: idea.title, caption: idea.caption, platform: idea.platform, format: idea.format, status: "idea", scheduled_for: null, owner_user_id: null, link: null });
      invalidate("social_posts");
      toast.success("Added to ideas", idea.title);
    } catch (e) {
      toast.error("Could not add idea", e instanceof Error ? e.message : "");
    }
  };

  const openPost = (p: SocialPost) => setDraft({ ...p, scheduled_for: p.scheduled_for ?? "" });

  const Chip = ({ p }: { p: SocialPost }) => {
    const o = owner(p.owner_user_id);
    return (
      <button
        onClick={() => openPost(p)}
        className={cn(
          "w-full cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06]",
          p.status === "posted" ? "border-brand-400/30 bg-brand-400/[0.06]" : p.status === "idea" ? "border-dashed border-line" : "border-line bg-white/[0.03]",
        )}
      >
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: platformInfo(p.platform).color }} />
          <span className={cn("truncate text-xs font-semibold", p.status === "posted" ? "text-zinc-400" : "text-white")}>{p.title}</span>
          {p.status === "posted" && <CheckCircle2 className="ml-auto h-3 w-3 shrink-0 text-brand-400" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="capitalize">{p.format}</span>
          <span>·</span>
          <span className="capitalize">{p.status}</span>
          {o && <span className="ml-auto rounded bg-white/10 px-1 text-zinc-300">{firstName(o)}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* Targets */}
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Target className="h-4 w-4 text-brand-300" /> This week&apos;s targets
            <span className="text-xs font-normal text-zinc-500">{weekLabel(days)}</span>
          </div>
          {canEdit && (
            <button onClick={() => setEditingTargets(true)} className="inline-flex cursor-pointer items-center gap-1 text-xs text-accent-400 hover:underline">
              <Pencil className="h-3 w-3" /> Edit targets
            </button>
          )}
        </div>
        {targets.length === 0 ? (
          <p className="text-sm text-zinc-500">No targets yet{canEdit ? " — set how many posts per week you want on each platform." : "."}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORMS.map((pl) => {
              const t = targets.find((x) => x.platform === pl.id);
              if (!t) return null;
              const n = weekCount(pl.id);
              const pct = t.posts_per_week ? Math.min(100, (n / t.posts_per_week) * 100) : 0;
              return (
                <div key={pl.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: pl.color }} /> {pl.label}
                  </div>
                  <p className="mt-1 font-display text-2xl font-bold tabular-nums text-white">
                    {n}<span className="text-base font-medium text-zinc-500"> / {t.posts_per_week} posts</span>
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full transition-all" style={{ width: `${pct}%`, background: n >= t.posts_per_week ? "#34d399" : pl.color }} />
                  </div>
                  {t.followers_goal ? (
                    <p className="mt-2 text-xs text-zinc-400">
                      Followers {t.followers_now ?? "—"} → {t.followers_goal}
                      {t.followers_now ? <span className="text-zinc-500"> ({Math.round((t.followers_now / t.followers_goal) * 100)}%)</span> : null}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        {/* Calendar */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous week" className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setOffset(0)} className="cursor-pointer rounded-lg px-2 py-1 text-sm font-semibold text-white hover:bg-white/5">{offset === 0 ? "This week" : weekLabel(days)}</button>
              <button onClick={() => setOffset((o) => o + 1)} aria-label="Next week" className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"><ChevronRight className="h-4 w-4" /></button>
              {offset !== 0 && <span className="text-xs text-zinc-500">{weekLabel(days)}</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-line bg-white/[0.03] p-0.5 text-xs font-semibold">
                {[false, true].map((m) => (
                  <button key={String(m)} onClick={() => setMineOnly(m)} className={cn("cursor-pointer rounded-full px-3 py-1", mineOnly === m ? "bg-brand-400/15 text-brand-300" : "text-zinc-400 hover:text-white")}>
                    {m ? "Mine" : "Everyone"}
                  </button>
                ))}
              </div>
              {canEdit && <Button onClick={() => setDraft(blank({ owner_user_id: user?.id ?? null }))}><Plus className="h-4 w-4" /> New post</Button>}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-7">
            {days.map((d, i) => {
              const k = keys[i];
              const list = byDay(k);
              return (
                <div key={k} className={cn("min-h-[120px] rounded-xl border p-2", k === today ? "border-brand-400/40 bg-brand-400/[0.04]" : "border-line bg-white/[0.02]")}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className={cn("text-[11px] font-semibold uppercase", k === today ? "text-brand-300" : "text-zinc-500")}>
                      {d.toLocaleDateString(undefined, { weekday: "short" })} <span className="text-zinc-400">{d.getDate()}</span>
                    </span>
                    {canEdit && (
                      <button onClick={() => setDraft(blank({ scheduled_for: k, status: "scheduled", owner_user_id: user?.id ?? null }))} aria-label={`Add post on ${k}`} className="cursor-pointer rounded p-0.5 text-zinc-600 hover:text-white">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">{list.map((p) => <Chip key={p.id} p={p} />)}</div>
                </div>
              );
            })}
          </div>

          {/* Ideas & drafts without a date */}
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
              <Lightbulb className="h-4 w-4 text-amber-soft" /> Ideas &amp; drafts <Badge tone="neutral">{tray.length}</Badge>
            </div>
            {tray.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing waiting — add one from the suggestions.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tray.map((p) => <Chip key={p.id} p={p} />)}</div>
            )}
          </Card>
        </div>

        {/* What to do next */}
        <Card className="h-fit p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">What to do next</h3>
          <ul className="space-y-2">
            {suggestions.slice(0, 7).map((s) => (
              <li key={s.id} className={cn("rounded-lg border px-3 py-2", s.tone === "rose" ? "border-rose-soft/40 bg-rose-soft/[0.06]" : s.tone === "amber" ? "border-amber-soft/40 bg-amber-soft/[0.05]" : s.tone === "green" ? "border-brand-400/30 bg-brand-400/[0.05]" : "border-line bg-white/[0.02]")}>
                <p className="text-sm font-semibold text-white">{s.title}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{s.detail}</p>
                {s.idea && canEdit && (
                  <button onClick={() => addIdea(s.idea!)} className="mt-1.5 cursor-pointer text-xs font-semibold text-accent-400 hover:underline">+ Add to ideas</button>
                )}
              </li>
            ))}
            {suggestions.length === 0 && <li className="text-sm text-zinc-500">You&apos;re on track.</li>}
          </ul>
        </Card>
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit post" : "New post"} wide>
        {draft && (
          <div className="space-y-4">
            <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Beef roast reel" autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Platform">
                <Select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value as SocialPlatform })}>
                  {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Format">
                <Select value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value as SocialFormat })}>
                  {FORMATS.map((f) => <option key={f} value={f} className="capitalize">{f}</option>)}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as SocialStatus })}>
                  {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Day"><Input type="date" value={draft.scheduled_for} onChange={(e) => setDraft({ ...draft, scheduled_for: e.target.value })} /></Field>
              <Field label="Who makes it">
                <Select value={draft.owner_user_id ?? ""} onChange={(e) => setDraft({ ...draft, owner_user_id: e.target.value || null })}>
                  <option value="">Nobody yet</option>
                  {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
                </Select>
              </Field>
              <Field label="Link to the live post"><Input value={draft.link ?? ""} onChange={(e) => setDraft({ ...draft, link: e.target.value || null })} placeholder="https://…" /></Field>
            </div>
            <Field label="Caption / notes"><Textarea rows={4} value={draft.caption ?? ""} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} /></Field>
            <div className="flex items-center gap-2">
              <Button className="flex-1" disabled={!draft.title.trim()} onClick={save}>{draft.id ? "Save" : "Add post"}</Button>
              {draft.id && draft.status !== "posted" && (
                <Button onClick={() => setDraft({ ...draft, status: "posted", scheduled_for: draft.scheduled_for || dayKey(new Date()) })}>Mark posted</Button>
              )}
              {draft.id && <button onClick={remove} className="cursor-pointer text-sm text-zinc-500 hover:text-rose-soft">Delete</button>}
            </div>
          </div>
        )}
      </Modal>

      <TargetsModal open={editingTargets} onClose={() => setEditingTargets(false)} orgId={org!.id} targets={targets} onSaved={() => invalidate("social_targets")} />
    </div>
  );
}

function TargetsModal({ open, onClose, orgId, targets, onSaved }: { open: boolean; onClose: () => void; orgId: string; targets: SocialTarget[]; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, { n: string; now: string; goal: string }>>({});
  const get = (p: SocialPlatform) => {
    const t = targets.find((x) => x.platform === p);
    return vals[p] ?? { n: String(t?.posts_per_week ?? 3), now: t?.followers_now?.toString() ?? "", goal: t?.followers_goal?.toString() ?? "" };
  };
  const set = (p: SocialPlatform, patch: Partial<{ n: string; now: string; goal: string }>) => setVals((v) => ({ ...v, [p]: { ...get(p), ...patch } }));

  const save = async () => {
    try {
      for (const pl of PLATFORMS) {
        const v = get(pl.id);
        await saveTarget(orgId, pl.id, { posts_per_week: Number(v.n) || 0, followers_now: v.now === "" ? null : Number(v.now), followers_goal: v.goal === "" ? null : Number(v.goal) }, targets.find((t) => t.platform === pl.id)?.id);
      }
      onSaved();
      toast.success("Targets saved");
      onClose();
    } catch (e) {
      toast.error("Could not save targets", e instanceof Error ? e.message : "");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Weekly targets" wide>
      <div className="space-y-3">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
          <span>Platform</span><span>Posts / week</span><span>Followers now</span><span>Follower goal</span>
        </div>
        {PLATFORMS.map((pl) => {
          const v = get(pl.id);
          return (
            <div key={pl.id} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-2">
              <span className="flex items-center gap-2 text-sm text-white"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pl.color }} />{pl.label}</span>
              <Input type="number" min={0} value={v.n} onChange={(e) => set(pl.id, { n: e.target.value })} />
              <Input type="number" min={0} value={v.now} onChange={(e) => set(pl.id, { now: e.target.value })} placeholder="—" />
              <Input type="number" min={0} value={v.goal} onChange={(e) => set(pl.id, { goal: e.target.value })} placeholder="—" />
            </div>
          );
        })}
        <Button className="mt-2 w-full" onClick={save}>Save targets</Button>
      </div>
    </Modal>
  );
}
