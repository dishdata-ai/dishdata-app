import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import type { OrgSite } from "@/lib/api/database.types";

// The demo store keys rows by `id`; an org has one site row, so its org id doubles as that id.
const dSites = demoTable<OrgSite & { id: string }>("org_sites");

export type OrgSiteInput = Pick<
  OrgSite,
  "site_url" | "display_name" | "logo_url" | "primary_color" | "table_path" | "from_name" | "from_address" | "reply_to" | "staff_alert_email"
>;

export async function getOrgSite(orgId: string): Promise<OrgSite | null> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dSites.list({ org_id: orgId } as Partial<OrgSite>)[0] ?? null;
  }
  const { data, error } = await getSupabase().from("org_sites").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return data;
}

/** The address a table QR points to: the restaurant's own site when set, else the hosted storefront. */
export function tableOrderUrl(
  site: Pick<OrgSite, "site_url" | "table_path"> | null,
  origin: string,
  slug: string,
  tableName: string,
): string {
  const base = site?.site_url?.replace(/\/$/, "");
  if (base) return base + (site?.table_path || "/t/{table}").replace("{table}", encodeURIComponent(tableName));
  return `${origin}/r/${slug}?table=${encodeURIComponent(tableName)}`;
}

/** Takeaway QR: the restaurant's menu page when it has a site, else the hosted storefront. */
export function takeawayOrderUrl(site: Pick<OrgSite, "site_url"> | null, origin: string, slug: string): string {
  const base = site?.site_url?.replace(/\/$/, "");
  return base ? `${base}/menu` : `${origin}/r/${slug}?order=takeaway`;
}

export async function saveOrgSite(orgId: string, input: OrgSiteInput): Promise<void> {
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const row = {
    ...input,
    site_url: clean(input.site_url)?.replace(/\/$/, "") ?? null,
    display_name: clean(input.display_name),
    logo_url: clean(input.logo_url),
    primary_color: clean(input.primary_color),
    table_path: clean(input.table_path) ?? "/t/{table}",
    from_name: clean(input.from_name),
    from_address: clean(input.from_address)?.toLowerCase() ?? null,
    reply_to: clean(input.reply_to)?.toLowerCase() ?? null,
    staff_alert_email: clean(input.staff_alert_email)?.toLowerCase() ?? null,
  };
  if (row.site_url && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(row.site_url)) throw new Error("The website address must start with https://");
  if (!row.table_path.includes("{table}")) throw new Error("The table link must contain {table}, for example /t/{table}");
  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dSites.list({ org_id: orgId } as Partial<OrgSite>)[0];
    const now = new Date().toISOString();
    if (existing) dSites.update(existing.id, { ...row, updated_at: now });
    else dSites.insert({ id: orgId, org_id: orgId, custom_domain: null, email_domain: null, resend_domain_id: null, email_domain_status: "none", email_dns_records: null, created_at: now, updated_at: now, ...row });
    return;
  }
  const { error } = await getSupabase().from("org_sites").upsert({ org_id: orgId, ...row });
  if (error) throw error;
}
