import { useEffect, useState } from "react";
import { Globe, CheckCircle2, AlertTriangle, RefreshCw, Copy } from "lucide-react";
import { Card, Button, Badge, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/hooks/useAuth";
import { useOrg } from "@/lib/hooks/useOrg";
import { useOrgSite, useInvalidate } from "@/lib/hooks/data";
import { saveOrgSite, type OrgSiteInput } from "@/lib/api/orgSite";
import { toast } from "@/lib/toast";
import type { OrgSite } from "@/lib/api/database.types";

type Draft = {
  site_url: string; display_name: string; logo_url: string; primary_color: string; table_path: string;
  from_name: string; from_address: string; reply_to: string; staff_alert_email: string;
};

const toDraft = (s: OrgSite | null | undefined): Draft => ({
  site_url: s?.site_url ?? "", display_name: s?.display_name ?? "", logo_url: s?.logo_url ?? "", primary_color: s?.primary_color ?? "",
  table_path: s?.table_path ?? "/t/{table}", from_name: s?.from_name ?? "", from_address: s?.from_address ?? "",
  reply_to: s?.reply_to ?? "", staff_alert_email: s?.staff_alert_email ?? "",
});

/**
 * Settings → Website & brand. One place for a restaurant's own website, branding and email
 * identity: table QR codes, order emails, sign-in codes and payment return pages all read it.
 */
export function SiteCard({ isAdmin }: { isAdmin: boolean }) {
  const { isDemo } = useAuth();
  const { org } = useOrg();
  const siteQ = useOrgSite();
  const invalidate = useInvalidate();
  const site = siteQ.data;
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [saving, setSaving] = useState(false);
  const [domainBusy, setDomainBusy] = useState(false);

  useEffect(() => {
    if (siteQ.isSuccess) setDraft(toDraft(site));
  }, [siteQ.isSuccess, site]);

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      await saveOrgSite(org.id, draft as OrgSiteInput);
      invalidate("org_site");
      toast.success("Saved");
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const domainCall = async (method: "POST" | "GET") => {
    setDomainBusy(true);
    try {
      if (method === "POST") await saveOrgSite(org!.id, draft as OrgSiteInput);
      const res = await fetch("/api/brand/email-domain", {
        method,
        ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ fromAddress: draft.from_address }) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      invalidate("org_site");
      if (data.status === "verified") toast.success("Email domain verified");
    } catch (e) {
      toast.error("Email domain", e instanceof Error ? e.message : "");
    } finally {
      setDomainBusy(false);
    }
  };

  const status = site?.email_domain_status ?? "none";
  const records = site?.email_dns_records ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Globe className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Website &amp; brand</h3>
        {status === "verified" && <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Email domain verified</Badge>}
        {status === "pending" && <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> Email domain pending</Badge>}
      </div>
      <p className="mb-4 text-sm text-zinc-400">
        Your own website and brand. Table QR codes, order emails, sign-in codes and payment pages use these, so your guests only ever see you.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Website address"><Input placeholder="https://yourrestaurant.de" value={draft.site_url} onChange={set("site_url")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Name in emails"><Input placeholder={org?.name} value={draft.display_name} onChange={set("display_name")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Logo link (optional)"><Input placeholder="https://…/logo.png" value={draft.logo_url} onChange={set("logo_url")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Brand colour (optional)"><Input placeholder="#134033" value={draft.primary_color} onChange={set("primary_color")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Table QR link on your site"><Input value={draft.table_path} onChange={set("table_path")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Restaurant alert email"><Input type="email" placeholder="orders@yourrestaurant.de" value={draft.staff_alert_email} onChange={set("staff_alert_email")} disabled={!isAdmin || isDemo} /></Field>
      </div>

      <h4 className="mb-2 mt-5 text-sm font-semibold text-white">Send emails from your own address</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sender name"><Input placeholder="kokoland" value={draft.from_name} onChange={set("from_name")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Sender address"><Input type="email" placeholder="orders@yourrestaurant.de" value={draft.from_address} onChange={set("from_address")} disabled={!isAdmin || isDemo} /></Field>
        <Field label="Replies go to"><Input type="email" placeholder="info@yourrestaurant.de" value={draft.reply_to} onChange={set("reply_to")} disabled={!isAdmin || isDemo} /></Field>
      </div>

      {isAdmin && !isDemo && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          <Button variant="ghost" onClick={() => domainCall("POST")} disabled={domainBusy || !draft.from_address.includes("@")}>
            {status === "none" ? "Set up email domain" : "Re-register domain"}
          </Button>
          {status !== "none" && (
            <Button variant="ghost" onClick={() => domainCall("GET")} disabled={domainBusy}>
              <RefreshCw className="h-4 w-4" /> Check DNS
            </Button>
          )}
        </div>
      )}
      {!isAdmin && <p className="mt-3 text-xs text-zinc-500">Ask an owner or admin to change these.</p>}

      {records.length > 0 && status !== "verified" && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <p className="mb-2 text-xs text-zinc-400">
            Add these records at your domain provider (DNS), then press <b>Check DNS</b>. If your domain already has an SPF record (a TXT starting with <code>v=spf1</code>), add Resend&apos;s include to it instead of creating a second one.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500"><tr><th className="pr-3">Type</th><th className="pr-3">Name</th><th className="pr-3">Value</th><th>Status</th></tr></thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-1 pr-3 font-mono">{r.type}</td>
                    <td className="py-1 pr-3 font-mono break-all">{r.name}</td>
                    <td className="py-1 pr-3 font-mono break-all">
                      {r.priority != null ? `${r.priority} ` : ""}{r.value}{" "}
                      <button type="button" aria-label="Copy value" className="cursor-pointer text-zinc-400 hover:text-white" onClick={() => navigator.clipboard.writeText(r.value)}><Copy className="inline h-3 w-3" /></button>
                    </td>
                    <td className="py-1">{r.status ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
