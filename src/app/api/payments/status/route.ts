import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { isStripeConfigured } from "@/lib/payments/config";

/**
 * GET /api/payments/status
 * Returns the live connection status for the caller's org and refreshes the
 * cached charges_enabled / details_submitted flags in orgs.settings.
 */
export async function GET() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ connected: false, configured: false });
  }

  const res = await resolveActiveOrg();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org } = res.value;

  const settings = readPaymentsSettings(org.settings);
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
