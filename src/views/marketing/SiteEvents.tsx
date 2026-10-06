"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Card, Badge, Button, Modal, Field, Input, Textarea } from "@/components/ui";
import { useSiteEvents, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { saveSiteEvent, deleteSiteEvent } from "@/lib/api/siteEvents";
import { dayKey } from "@/lib/api/availability";
import { toast } from "@/lib/toast";
import type { WebsiteEvent } from "@/lib/api/database.types";

type Draft = {
  id?: string;
  title: string;
  description: string;
  event_date: string;
  event_time: string;
  tag: string;
  cta_url: string;
};

const blank = (): Draft => ({ title: "", description: "", event_date: "", event_time: "", tag: "", cta_url: "" });

const fromEvent = (e: WebsiteEvent): Draft => ({
  id: e.id,
  title: e.title,
  description: e.description ?? "",
  event_date: e.event_date,
  event_time: e.event_time ?? "",
  tag: e.tag ?? "",
  cta_url: e.cta_url ?? "",
});

const fmt = (ymd: string) =>
  new Date(`${ymd}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function SiteEvents() {
  const { org, isManager, isPartner } = useOrg();
  const invalidate = useInvalidate();
  const eventsQ = useSiteEvents();
  const canEdit = isManager || isPartner;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const today = dayKey(new Date());
  const { upcoming, past } = useMemo(() => {
    const all = eventsQ.data ?? [];
    return {
      upcoming: all.filter((e) => e.event_date >= today).sort((a, b) => a.event_date.localeCompare(b.event_date)),
      past: all.filter((e) => e.event_date < today).sort((a, b) => b.event_date.localeCompare(a.event_date)),
    };
  }, [eventsQ.data, today]);
  const editing = draft?.id ? (eventsQ.data ?? []).find((e) => e.id === draft.id) : undefined;

  const save = async (status: WebsiteEvent["status"]) => {
    if (!draft || !org) return;
    if (!draft.title.trim() || !draft.event_date) {
      toast.error("A title and a date are required");
      return;
    }
    setSaving(true);
    try {
      await saveSiteEvent(
        org.id,
        {
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          event_date: draft.event_date,
          event_time: draft.event_time.trim() || null,
          tag: draft.tag.trim() || null,
          cta_url: draft.cta_url.trim() || null,
          status,
        },
        editing,
      );
      invalidate("website_events");
      toast.success(status === "published" ? "Event is live on the website" : "Saved as draft");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the event");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || !org || !confirm("Delete this event?")) return;
    try {
      await deleteSiteEvent(org.id, draft.id);
      invalidate("website_events");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the event");
    }
  };

  const row = (e: WebsiteEvent, dim = false) => (
    <Card key={e.id} className={`flex items-center gap-3 p-3 ${dim ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{e.title}</div>
        <div className="truncate text-xs text-zinc-500">
          {fmt(e.event_date)}
          {e.event_time ? ` · ${e.event_time}` : ""}
          {e.tag ? ` · ${e.tag}` : ""}
        </div>
      </div>
      <Badge tone={e.status === "published" ? "green" : "neutral"}>{e.status === "published" ? "On website" : "Draft"}</Badge>
      {canEdit && (
        <button onClick={() => setDraft(fromEvent(e))} className="cursor-pointer rounded-md p-2 text-zinc-400 hover:text-white" aria-label="Edit event">
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">Events shown in the &quot;What&apos;s on&quot; section of your website. Only published, upcoming events appear.</p>
        {canEdit && (
          <Button onClick={() => setDraft(blank())}>
            <Plus className="h-4 w-4" /> New event
          </Button>
        )}
      </div>

      {eventsQ.isLoading ? (
        <Card className="p-6 text-sm text-zinc-500">Loading…</Card>
      ) : upcoming.length + past.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">No events yet. Add the next one and publish it to show it on the website.</Card>
      ) : (
        <>
          <div className="space-y-2">{upcoming.map((e) => row(e))}</div>
          {past.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Past</div>
              {past.map((e) => row(e, true))}
            </div>
          )}
        </>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit event" : "New event"} wide>
        {draft && (
          <div className="space-y-4">
            <Field label="Title"><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Halloween at kokoland" autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date"><Input type="date" value={draft.event_date} onChange={(e) => setDraft({ ...draft, event_date: e.target.value })} /></Field>
              <Field label="Time (optional)"><Input value={draft.event_time} onChange={(e) => setDraft({ ...draft, event_time: e.target.value })} placeholder="19:00" /></Field>
              <Field label="Badge (optional)"><Input value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} placeholder="Live, Feast, Halloween…" maxLength={20} /></Field>
            </div>
            <Field label="Description"><Textarea rows={3} maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="One or two lines about the night." /></Field>
            <Field label="Link (optional, otherwise the booking form opens)"><Input value={draft.cta_url} onChange={(e) => setDraft({ ...draft, cta_url: e.target.value })} placeholder="https://…" /></Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button className="flex-1" disabled={saving} onClick={() => save("published")}>
                {editing?.status === "published" ? "Save changes" : "Publish to website"}
              </Button>
              <Button disabled={saving} onClick={() => save("draft")}>
                {editing?.status === "published" ? "Unpublish" : "Save draft"}
              </Button>
              {draft.id && <button onClick={remove} className="cursor-pointer text-sm text-zinc-500 hover:text-rose-soft">Delete</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
