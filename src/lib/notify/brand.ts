import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrgBrand {
  name: string;
  siteUrl: string;
  primaryColor: string;
  /** "Name <address>" only once the sending domain is verified in Resend, otherwise undefined (platform default). */
  from?: string;
  replyTo?: string;
  staffEmail?: string;
}

/**
 * One restaurant's identity for emails and return links, read with the service role
 * (the table is staff-only). Falls back to the old server settings, so Kokoland keeps
 * working until its "Website & brand" card is filled in.
 */
export async function getOrgBrand(admin: SupabaseClient, orgId: string): Promise<OrgBrand> {
  const [{ data: org }, { data: site }] = await Promise.all([
    admin.from("orgs").select("name").eq("id", orgId).maybeSingle(),
    admin.from("org_sites").select("*").eq("org_id", orgId).maybeSingle(),
  ]);
  const name = site?.display_name || org?.name || "Restaurant";
  const verified = site?.email_domain_status === "verified" && site?.from_address;
  return {
    name,
    siteUrl: (site?.site_url || process.env.NOTIFY_SITE_URL || "").replace(/\/$/, ""),
    primaryColor: site?.primary_color || "#134033",
    from: verified ? `${(site?.from_name || name).replace(/[<>"]/g, "")} <${site!.from_address}>` : undefined,
    replyTo: site?.reply_to || process.env.EMAIL_REPLY_TO || undefined,
    staffEmail: site?.staff_alert_email || process.env.NOTIFY_STAFF_EMAIL || undefined,
  };
}
