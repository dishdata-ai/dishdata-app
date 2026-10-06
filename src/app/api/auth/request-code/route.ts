import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { sendEmail } from "@/lib/notify/email";
import { getOrgBrand } from "@/lib/notify/brand";

/**
 * POST /api/auth/request-code   { slug, email, name?, lang? }   header: x-notify-secret
 * Emails a restaurant guest a 6-digit sign-in code in THAT restaurant's brand, from its own
 * domain when verified. Supabase's global sign-in template is the same for every restaurant
 * and rate limited, so the code is generated here and mailed through Resend. The website
 * then completes the login with supabase.auth.verifyOtp({ type: "email" }).
 *
 * Called by the restaurant website's server (shared secret), never directly by browsers.
 * Rate limit: 5 codes per address and 20 per IP per hour.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret || req.headers.get("x-notify-secret") !== secret) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  let body: { slug?: string; email?: string; name?: string; lang?: string; ip?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase() ?? "";
  if (!EMAIL.test(email) || !body.slug) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const ip = (body.ip ?? "").slice(0, 64) || null;

  const since = new Date(Date.now() - 3600_000).toISOString();
  const [{ count: byEmail }, { count: byIp }] = await Promise.all([
    admin.from("auth_code_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since),
    ip ? admin.from("auth_code_requests").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since) : Promise.resolve({ count: 0 }),
  ]);
  if ((byEmail ?? 0) >= 5 || (byIp ?? 0) >= 20) return NextResponse.json({ error: "Too many codes requested. Please try again in an hour." }, { status: 429 });

  const { data: org } = await admin.from("orgs").select("id").eq("slug", body.slug).maybeSingle();
  if (!org) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });

  // Creates the guest on first use; the returned code is what the guest types in.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: body.name?.trim() ? { data: { full_name: body.name.trim() } } : undefined,
  });
  const code = data?.properties?.email_otp;
  if (error || !code) return NextResponse.json({ error: "Could not create a sign-in code." }, { status: 500 });
  await admin.from("auth_code_requests").insert({ email, ip });

  const brand = await getOrgBrand(admin, org.id);
  const de = body.lang === "de";
  const t = de
    ? { subject: `Dein Anmeldecode für ${brand.name}`, intro: "Dein Code zum Anmelden:", note: "Er gilt kurze Zeit. Hast du ihn nicht angefordert, ignoriere diese E-Mail." }
    : { subject: `Your sign-in code for ${brand.name}`, intro: "Your sign-in code:", note: "It works for a short time. If you did not ask for it, ignore this email." };
  const ok = await sendEmail({
    to: email,
    from: brand.from,
    replyTo: brand.replyTo,
    subject: t.subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#222"><h2 style="color:${esc(brand.primaryColor)}">${esc(brand.name)}</h2><p>${esc(t.intro)}</p><p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:${esc(brand.primaryColor)}">${esc(code)}</p><p style="color:#666;font-size:13px">${esc(t.note)}</p></div>`,
    text: `${t.intro} ${code}\n\n${t.note}`,
  });
  if (!ok) return NextResponse.json({ error: "Could not send the email." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
