"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, Pencil, Plus } from "lucide-react";
import { Card, Badge, Button, Modal, Field, Input, Select, Textarea } from "@/components/ui";
import { useBlogPosts, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { saveBlogPost, deleteBlogPost, slugify, type BlogInput } from "@/lib/api/blog";
import { uploadOrgAsset } from "@/lib/api/orgs";
import { toast } from "@/lib/toast";
import type { BlogPost } from "@/lib/api/database.types";

type Draft = BlogInput & { id?: string; slugTouched: boolean };

const blank = (): Draft => ({
  slug: "", title: "", excerpt: "", body_md: "", cover_url: null, lang: "en", status: "draft", slugTouched: false,
});

const fromPost = (p: BlogPost): Draft => ({
  id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt ?? "", body_md: p.body_md,
  cover_url: p.cover_url, lang: p.lang, status: p.status, slugTouched: true,
});

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function Blog() {
  const { org, isManager, isPartner } = useOrg();
  const invalidate = useInvalidate();
  const postsQ = useBlogPosts();
  const canEdit = isManager || isPartner;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const posts = useMemo(
    () => [...(postsQ.data ?? [])].sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at)),
    [postsQ.data],
  );
  const editing = draft?.id ? posts.find((p) => p.id === draft.id) : undefined;

  const setTitle = (title: string) =>
    setDraft((d) => (d ? { ...d, title, slug: d.slugTouched ? d.slug : slugify(title) } : d));

  const save = async (status: Draft["status"]) => {
    if (!draft || !org) return;
    const slug = slugify(draft.slug);
    if (!draft.title.trim() || !slug) {
      toast.error("A title and a URL are required");
      return;
    }
    setSaving(true);
    try {
      await saveBlogPost(
        org.id,
        { slug, title: draft.title.trim(), excerpt: draft.excerpt?.trim() || null, body_md: draft.body_md, cover_url: draft.cover_url, lang: draft.lang, status },
        editing,
      );
      invalidate("blog_posts");
      toast.success(status === "published" ? "Published" : "Saved as draft");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the post");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || !org || !confirm("Delete this post? This cannot be undone.")) return;
    try {
      await deleteBlogPost(org.id, draft.id);
      invalidate("blog_posts");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the post");
    }
  };

  const onCover = async (file: File | undefined) => {
    if (!file || !org || !draft) return;
    setUploading(true);
    try {
      const url = await uploadOrgAsset(org.id, file, `blog/${slugify(draft.slug || draft.title) || "post"}-${Date.now()}.webp`, 1600);
      setDraft((d) => (d ? { ...d, cover_url: url } : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload the image");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">Articles shown on your website&apos;s blog. Write in Markdown; drafts stay private until you publish.</p>
        {canEdit && (
          <Button onClick={() => setDraft(blank())}>
            <Plus className="h-4 w-4" /> New post
          </Button>
        )}
      </div>

      {postsQ.isLoading ? (
        <Card className="p-6 text-sm text-zinc-500">Loading…</Card>
      ) : posts.length === 0 ? (
        <Card className="p-8 text-center text-sm text-zinc-500">No posts yet. Good first ones: the Onam Sadhya guide, what porotta and beef is, an events recap.</Card>
      ) : (
        <div className="space-y-2">
          {posts.map((p) => (
            <Card key={p.id} className="flex items-center gap-3 p-3">
              {p.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.cover_url} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="h-12 w-16 shrink-0 rounded-md bg-white/[0.04]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{p.title}</div>
                <div className="truncate text-xs text-zinc-500">/blog/{p.slug} · {p.lang.toUpperCase()} · {p.status === "published" ? `Published ${fmt(p.published_at)}` : `Edited ${fmt(p.updated_at)}`}</div>
              </div>
              <Badge tone={p.status === "published" ? "green" : "neutral"}>{p.status === "published" ? "Published" : "Draft"}</Badge>
              {canEdit && (
                <button onClick={() => setDraft(fromPost(p))} className="cursor-pointer rounded-md p-2 text-zinc-400 hover:text-white" aria-label="Edit post">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? "Edit post" : "New post"} wide>
        {draft && (
          <div className="space-y-4">
            <Field label="Title"><Input value={draft.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Onam Sadhya in Berlin: what to expect" autoFocus /></Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label="URL"><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value, slugTouched: true })} placeholder="onam-sadhya-berlin" /></Field>
              <Field label="Language">
                <Select value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as Draft["lang"] })}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </Select>
              </Field>
            </div>
            <Field label="Short summary (shown in the list and in Google)">
              <Textarea rows={2} maxLength={300} value={draft.excerpt ?? ""} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} />
            </Field>

            <Field label="Cover image">
              <div className="flex items-center gap-3">
                {draft.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.cover_url} alt="" className="h-16 w-24 rounded-md object-cover" />
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onCover(e.target.files?.[0])} />
                <Button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" /> {uploading ? "Uploading…" : draft.cover_url ? "Replace" : "Add image"}
                </Button>
                {draft.cover_url && (
                  <button type="button" onClick={() => setDraft({ ...draft, cover_url: null })} className="cursor-pointer text-sm text-zinc-500 hover:text-rose-soft">Remove</button>
                )}
              </div>
            </Field>

            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Article (Markdown: # heading, **bold**, - list, [link](https://…))">
                <Textarea rows={16} className="font-mono text-xs" value={draft.body_md} onChange={(e) => setDraft({ ...draft, body_md: e.target.value })} />
              </Field>
              <div>
                <div className="mb-1.5 text-xs font-medium text-zinc-400">Preview</div>
                <div className="prose-invert max-h-[26rem] space-y-3 overflow-auto rounded-lg border border-line bg-white/[0.02] p-4 text-sm text-zinc-200 [&_a]:text-brand-300 [&_a]:underline [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc">
                  {draft.body_md.trim() ? <ReactMarkdown>{draft.body_md}</ReactMarkdown> : <span className="text-zinc-600">Nothing to preview yet.</span>}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button className="flex-1" disabled={saving} onClick={() => save("published")}>
                {editing?.status === "published" ? "Save & keep published" : "Publish"}
              </Button>
              <Button disabled={saving} onClick={() => save("draft")}>
                {editing?.status === "published" ? "Unpublish (back to draft)" : "Save draft"}
              </Button>
              {draft.id && <button onClick={remove} className="cursor-pointer text-sm text-zinc-500 hover:text-rose-soft">Delete</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
