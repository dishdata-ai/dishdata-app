"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { Card, Badge, Button, Modal, Field, Input, Textarea } from "@/components/ui";
import { useRecipes, useWeeklyDishes, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { saveWeeklyDish, deleteWeeklyDish } from "@/lib/api/weeklyDish";
import { dayKey } from "@/lib/api/availability";
import { toast } from "@/lib/toast";
import type { Recipe, WeeklyDish as WeeklyDishRow } from "@/lib/api/database.types";

type Draft = { id?: string; starts_on: string; recipe_id: string; headline: string; region: string; story: string };

const REGIONS = ["Malabar", "Travancore", "Kochi", "Kuttanad", "Hill country"];

const noon = (ymd: string) => new Date(`${ymd}T12:00:00`);
const addDays = (ymd: string, n: number) => {
  const d = noon(ymd);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
const short = (ymd: string) => noon(ymd).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const range = (startsOn: string) => `${short(startsOn)} – ${short(addDays(startsOn, 6))}`;

export default function WeeklyDish() {
  const { org, isManager, isPartner } = useOrg();
  const invalidate = useInvalidate();
  const weeksQ = useWeeklyDishes();
  const recipesQ = useRecipes();
  const canEdit = isManager || isPartner;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const live = useMemo(() => (recipesQ.data ?? []).filter((r) => r.is_active), [recipesQ.data]);
  const byId = useMemo(() => new Map((recipesQ.data ?? []).map((r) => [r.id, r])), [recipesQ.data]);
  const weeks = useMemo(() => [...(weeksQ.data ?? [])].sort((a, b) => b.starts_on.localeCompare(a.starts_on)), [weeksQ.data]);
  const today = dayKey(new Date());

  const statusOf = (startsOn: string) => (startsOn > today ? "upcoming" : addDays(startsOn, 7) > today ? "live" : "past");
  const editing = draft?.id ? weeks.find((w) => w.id === draft.id) : undefined;

  const open = (w?: WeeklyDishRow) => {
    if (w) {
      setDraft({ id: w.id, starts_on: w.starts_on, recipe_id: w.recipe_id, headline: w.headline ?? "", region: w.region ?? "", story: w.story ?? "" });
    } else {
      const next = weeks.length ? addDays(weeks[0].starts_on, 7) : today;
      setDraft({ starts_on: next > today ? next : today, recipe_id: "", headline: "", region: "", story: "" });
    }
    setQuery("");
  };

  const picked = draft?.recipe_id ? byId.get(draft.recipe_id) : undefined;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return live.filter((r) => !q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)).slice(0, 10);
  }, [live, query]);

  const save = async () => {
    if (!draft || !org) return;
    if (!draft.starts_on) return toast.error("Pick the day the week starts");
    if (!draft.recipe_id) return toast.error("Pick the dish of the week");
    setSaving(true);
    try {
      await saveWeeklyDish(
        org.id,
        {
          starts_on: draft.starts_on,
          recipe_id: draft.recipe_id,
          headline: draft.headline.trim() || null,
          region: draft.region.trim() || null,
          story: draft.story.trim() || null,
        },
        editing,
      );
      invalidate("weekly_dish");
      toast.success("Saved. It shows on the menu page while the week is running.");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || !org || !confirm("Remove this dish of the week?")) return;
    try {
      await deleteWeeklyDish(org.id, draft.id);
      invalidate("weekly_dish");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove");
    }
  };

  const label = (r: Recipe | undefined) => (r ? `${r.emoji ?? ""} ${r.name}`.trim() : "Dish no longer on the menu");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          One live dish gets the spotlight on your website&apos;s menu page, with the story behind it. The rest of the page is your active recipes, so rotating the menu in Recipes updates it automatically.
        </p>
        {canEdit && (
          <Button onClick={() => open()}>
            <Plus className="h-4 w-4" /> Plan a week
          </Button>
        )}
      </div>

      {weeksQ.isLoading ? (
        <Card className="p-6 text-sm text-zinc-500">Loading…</Card>
      ) : weeks.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">No dish of the week yet. Pick one and tell its story.</Card>
      ) : (
        <div className="space-y-2">
          {weeks.map((w) => {
            const st = statusOf(w.starts_on);
            const r = byId.get(w.recipe_id);
            return (
              <Card key={w.id} className={`flex items-center gap-3 p-4 ${st === "past" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">{label(r)}</span>
                    <Badge tone={st === "live" ? "green" : st === "upcoming" ? "cyan" : "neutral"}>
                      {st === "live" ? "On the website now" : st === "upcoming" ? "Upcoming" : "Past"}
                    </Badge>
                    {r && !r.is_active && <Badge tone="amber">Not live in Recipes</Badge>}
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {range(w.starts_on)}
                    {w.headline ? ` · ${w.headline}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <button onClick={() => open(w)} className="cursor-pointer rounded-md p-2 text-zinc-400 hover:text-white" aria-label="Edit week">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit dish of the week" : "Plan a dish of the week"} wide>
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-end">
              <Field label="Week starts on">
                <Input type="date" value={draft.starts_on} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })} />
              </Field>
              {draft.starts_on && <p className="pb-2 text-sm text-zinc-400">Runs {range(draft.starts_on)}</p>}
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium text-zinc-400">Dish (from your live recipes)</div>
              {picked ? (
                <div className="flex items-center gap-3 rounded-lg border border-brand-400/30 bg-brand-500/5 p-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{label(picked)}</span>
                  <button type="button" onClick={() => setDraft({ ...draft, recipe_id: "" })} className="cursor-pointer text-zinc-400 hover:text-rose-soft" aria-label="Change dish">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your live dishes…" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {matches.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setDraft({ ...draft, recipe_id: r.id })}
                        className="cursor-pointer rounded-full border border-line px-3 py-1.5 text-xs text-zinc-300 hover:border-brand-400/40 hover:text-white"
                      >
                        {label(r)}
                      </button>
                    ))}
                    {matches.length === 0 && <span className="text-xs text-zinc-500">No live dish matches.</span>}
                  </div>
                </>
              )}
            </div>

            <Field label="Headline (one big line)">
              <Input value={draft.headline} maxLength={80} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} placeholder="e.g. Sunday biryani, the Malabar way" />
            </Field>

            <div>
              <Field label="Region in Kerala">
                <Input value={draft.region} maxLength={30} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="Malabar, Travancore…" />
              </Field>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REGIONS.map((r) => (
                  <button key={r} type="button" onClick={() => setDraft({ ...draft, region: r })} className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white">
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <Field label="The story behind the dish (blank line = new paragraph)">
              <Textarea rows={7} maxLength={900} value={draft.story} onChange={(e) => setDraft({ ...draft, story: e.target.value })} placeholder="Where it comes from, who cooks it at home, how we make it, what to eat it with…" />
            </Field>

            <div className="flex items-center gap-2">
              <Button className="flex-1" disabled={saving} onClick={save}>Save</Button>
              {draft.id && <button onClick={remove} className="cursor-pointer text-sm text-zinc-500 hover:text-rose-soft">Remove</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
