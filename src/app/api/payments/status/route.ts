import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { appUrl, isStripeConfigured } from "@/lib/payments/config";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import Stripe from "stripe";

/**
 * GET /api/payments/status
 * Returns the live connection status for the caller's org and refreshes the
 * cached charges_enabled / details_submitted flags in orgs.settings.
 */
export async function GET() {
  const res = await resolveActiveOrg();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org } = res.value;

  const settings = readPaymentsSettings(org.settings);

  // Direct mode: the restaurant's own keys, held server-side.
  if (settings.mode === "direct") {
    const admin = createSupabaseAdmin();
    const { data: sec } = admin
      ? await admin.from("org_payment_secrets").select("stripe_secret_key, stripe_webhook_secret").eq("org_id", org.id).maybeSingle()
      : { data: null };
    if (!sec?.stripe_secret_key) return NextResponse.json({ connected: false, configured: true, mode: "direct" });
    try {
      const acct = await new Stripe(sec.stripe_secret_key).accounts.retrieveCurrent();
      const next = { ...settings, account_id: acct.id, charges_enabled: acct.charges_enabled ?? false, details_submitted: acct.details_submitted ?? false };
      await sb.from("orgs").update({ settings: { ...org.settings, payments: next } }).eq("id", org.id);
      return NextResponse.json({
        connected: true,
        configured: true,
        mode: "direct",
        accountId: acct.id,
        chargesEnabled: acct.charges_enabled ?? false,
        detailsSubmitted: acct.details_submitted ?? false,
        hasWebhookSecret: !!sec.stripe_webhook_secret,
        webhookUrl: `${appUrl()}/api/payments/direct-webhook?org=${org.id}`,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Could not reach Stripe with the saved key." }, { status: 500 });
    }
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ connected: false, configured: false });
  }
  if (!settings.account_id) {
    return NextResponse.json({ connected: false, configured: true });
  }

  try {
    const provider = getPaymentProvider(settings);
    const status = await provider.getAccountStatus(settings.account_id);

    // Refresh the cached flags so other code can read them without a Stripe call.
    const next = {
      ...settings,
      charges_enabled: status.chargesEnabled,
      details_submitted: status.detailsSubmitted,
    };
    await sb
      .from("orgs")
      .update({ settings: { ...org.settings, payments: next } })
      .eq("id", org.id);

    return NextResponse.json({
      connected: true,
      configured: true,
      accountId: status.accountId,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
      detailsSubmitted: status.detailsSubmitted,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read account status." },
      { status: 500 },
    );
  }
}
