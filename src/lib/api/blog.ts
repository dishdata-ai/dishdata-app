import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type { BlogPost } from "@/lib/api/database.types";

const dPosts = demoTable<BlogPost>("blog_posts");

export type BlogInput = Pick<BlogPost, "slug" | "title" | "excerpt" | "body_md" | "cover_url" | "lang" | "status">;

/** URL-safe slug; German umlauts and ß are transliterated rather than dropped. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function listBlogPosts(orgId: string): Promise<BlogPost[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPosts.list({ org_id: orgId } as Partial<BlogPost>);
  }
  const { data, error } = await getSupabase()
    .from("blog_posts")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Publishing stamps published_at once; later edits keep the original date. */
function withPublishDate(input: BlogInput, existing?: BlogPost): BlogInput & { published_at: string | null } {
  const published_at =
    input.status === "published" ? (existing?.published_at ?? new Date().toISOString()) : (existing?.published_at ?? null);
  return { ...input, published_at };
}

export async function saveBlogPost(orgId: string, input: BlogInput, existing?: BlogPost): Promise<void> {
  const row = withPublishDate(input, existing);
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    if (existing) dPosts.update(existing.id, { ...row, updated_at: now });
    else dPosts.insert({ id: uid(), org_id: orgId, created_at: now, updated_at: now, ...row });
    return;
  }
  const sb = getSupabase();
  const { error } = existing
    ? await sb.from("blog_posts").update(row).eq("id", existing.id).eq("org_id", orgId)
    : await sb.from("blog_posts").insert({ org_id: orgId, ...row });
  if (error) {
    if (error.code === "23505") throw new Error("Another post already uses this URL — change the slug.");
    throw error;
  }
}

export async function deleteBlogPost(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPosts.remove(id);
    return;
  }
  const { error } = await getSupabase().from("blog_posts").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
