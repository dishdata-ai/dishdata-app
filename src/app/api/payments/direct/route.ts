import { NextResponse } from "next/server";
import Stripe from "stripe";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { readPaymentsSettings } from "@/lib/payments";
import { appUrl } from "@/lib/payments/config";
import { createSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Direct mode: a restaurant with its own Stripe account (its own company) pastes its keys
 * instead of using Stripe Connect. Money goes straight to that account, no platform fee.
 *
 * POST { secretKey?, webhookSecret? }  validate and store the key and/or the webhook signing secret.
 * DELETE                              forget the keys and switch payments off.
 *
 * Keys are stored in org_payment_secrets (service role only) and are never sent back to the browser.
 */
const KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;
const WHSEC = /^whsec_[A-Za-z0-9]{10,}$/;

export async function POST(req: Request) {
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org, isAdmin } = res.value;
  if (!isAdmin) return NextResponse.json({ error: "Only owners/admins can change payment settings." }, { status: 403 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { secretKey?: string; webhookSecret?: string };
  const secretKey = body.secretKey?.trim();
  const webhookSecret = body.webhookSecret?.trim();
  if (!secretKey && !webhookSecret) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  if (secretKey && !KEY.test(secretKey)) return NextResponse.json({ error: "That does not look like a Stripe secret key (sk_test_… or sk_live_…)." }, { status: 400 });
  if (webhookSecret && !WHSEC.test(webhookSecret)) return NextResponse.json({ error: "That does not look like a webhook signing secret (whsec_…)." }, { status: 400 });

  const settings = readPaymentsSettings(org.settings);
  let next = { ...settings };

  if (secretKey) {
    // Prove the key works and learn which account it belongs to.
    let account: Stripe.Account;
    try {
      account = await new Stripe(secretKey).accounts.retrieveCurrent();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? `Stripe rejected the key: ${e.message}` : "Stripe rejected the key." }, { status: 400 });
    }
    next = { provider: "stripe", mode: "direct", account_id: account.id, charges_enabled: account.charges_enabled ?? false, details_submitted: account.details_submitted ?? false };
    const { error } = await admin.from("org_payment_secrets").upsert({ org_id: org.id, stripe_secret_key: secretKey, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (webhookSecret) {
    const { error } = await admin.from("org_payment_secrets").upsert({ org_id: org.id, stripe_webhook_secret: webhookSecret, updated_at: new Date().toISOString() });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { error: setErr } = await sb.from("orgs").update({ settings: { ...org.settings, payments: next } }).eq("id", org.id);
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  const { data: sec } = await admin.from("org_payment_secrets").select("stripe_secret_key, stripe_webhook_secret").eq("org_id", org.id).maybeSingle();
  return NextResponse.json({
    mode: "direct",
    chargesEnabled: !!next.charges_enabled,
    accountId: next.account_id,
    hasKey: !!sec?.stripe_secret_key,
    hasWebhookSecret: !!sec?.stripe_webhook_secret,
    webhookUrl: `${appUrl()}/api/payments/direct-webhook?org=${org.id}`,
  });
}

export async function DELETE(req: Request) {
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org, isAdmin } = res.value;
  if (!isAdmin) return NextResponse.json({ error: "Only owners/admins can change payment settings." }, { status: 403 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  await admin.from("org_payment_secrets").delete().eq("org_id", org.id);
  const { payments: _removed, ...rest } = (org.settings ?? {}) as Record<string, unknown>;
  void _removed;
  const { error } = await sb.from("orgs").update({ settings: rest }).eq("id", org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
