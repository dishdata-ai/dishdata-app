import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";

// Manages the restaurant's email sending domain in the platform's Resend account.
//   POST  { fromAddress }  register the domain of that address, return the DNS records to add
//   GET                    re-check: ask Resend to verify, return the current status and records
// Only owners/admins. Managing domains needs a Resend key with full access, kept apart from the
// sending key: set RESEND_ADMIN_KEY (falls back to RESEND_API_KEY if that one has full access).
const adminKey = () => process.env.RESEND_ADMIN_KEY || process.env.RESEND_API_KEY;

const RESEND = "https://api.resend.com";

interface ResendDomain {
  id?: string;
  name?: string;
  status?: string;
  records?: { record: string; name: string; type: string; value: string; status?: string; priority?: number }[];
  message?: string;
}

async function resend(path: string, init?: RequestInit): Promise<{ ok: boolean; data: ResendDomain }> {
  const res = await fetch(`${RESEND}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${adminKey()}`, "content-type": "application/json" },
    cache: "no-store",
  }).catch(() => null);
  const data = (res ? await res.json().catch(() => ({})) : { message: "Could not reach Resend." }) as ResendDomain;
  return { ok: !!res?.ok, data };
}

const toStatus = (s?: string) => (s === "verified" ? "verified" : s === "failed" || s === "temporary_failure" ? "failed" : "pending");

export async function POST(req: Request) {
  if (!adminKey()) return NextResponse.json({ error: "Email sending is not configured on the server (RESEND_ADMIN_KEY)." }, { status: 400 });
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org, isAdmin } = res.value;
  if (!isAdmin) return NextResponse.json({ error: "Only owners/admins can change email settings." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { fromAddress?: string };
  const address = body.fromAddress?.trim().toLowerCase() ?? "";
  const domain = address.split("@")[1];
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address) || !domain) {
    return NextResponse.json({ error: "Enter a sender address like orders@yourdomain.com." }, { status: 400 });
  }

  const created = await resend("/domains", { method: "POST", body: JSON.stringify({ name: domain }) });
  let domainData = created.data;
  if (!created.ok) {
    // Already registered in this account: find it instead of failing.
    const list = await resend("/domains");
    const found = ((list.data as unknown as { data?: ResendDomain[] }).data ?? []).find((d) => d.name === domain);
    if (!found?.id) return NextResponse.json({ error: created.data.message ?? "Resend refused the domain. The key may need full access (RESEND_ADMIN_KEY)." }, { status: 502 });
    domainData = (await resend(`/domains/${found.id}`)).data;
  }

  const { error } = await sb.from("org_sites").upsert({
    org_id: org.id,
    from_address: address,
    email_domain: domain,
    resend_domain_id: domainData.id,
    email_domain_status: toStatus(domainData.status),
    email_dns_records: domainData.records ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: toStatus(domainData.status), records: domainData.records ?? [] });
}

export async function GET(req: Request) {
  if (!adminKey()) return NextResponse.json({ error: "Email sending is not configured on the server (RESEND_ADMIN_KEY)." }, { status: 400 });
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org, isAdmin } = res.value;
  if (!isAdmin) return NextResponse.json({ error: "Only owners/admins can change email settings." }, { status: 403 });

  const { data: site } = await sb.from("org_sites").select("resend_domain_id").eq("org_id", org.id).maybeSingle();
  if (!site?.resend_domain_id) return NextResponse.json({ error: "No email domain set up yet." }, { status: 404 });

  // Ask Resend to look at the DNS now, then read the result back.
  await resend(`/domains/${site.resend_domain_id}/verify`, { method: "POST" });
  const { ok, data } = await resend(`/domains/${site.resend_domain_id}`);
  if (!ok) return NextResponse.json({ error: data.message ?? "Could not read the domain from Resend." }, { status: 502 });

  await sb.from("org_sites").update({ email_domain_status: toStatus(data.status), email_dns_records: data.records ?? null }).eq("org_id", org.id);
  return NextResponse.json({ status: toStatus(data.status), records: data.records ?? [] });
}
