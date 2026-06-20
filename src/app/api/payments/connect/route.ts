import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { isStripeConfigured } from "@/lib/payments/config";

/**
 * POST /api/payments/connect
 * Starts (or resumes) Stripe Connect onboarding for the caller's org and
 * returns a hosted onboarding URL. Persists the connected account id so a
 * resumed onboarding reuses the same account.
 */
export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured on the server." }, { status: 400 });
  }

  const res = await resolveActiveOrg();
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { sb, org, isAdmin } = res.value;
  if (!isAdmin) {
    return NextResponse.json({ error: "Only owners/admins can connect payments." }, { status: 403 });
  }

  const settings = readPaymentsSettings(org.settings);
  const provider = getPaymentProvider(settings);

  try {
    const { accountId, url } = await provider.createOnboardingLink(org.id, settings.account_id);

    // Persist the account id (RLS lets owners update their own org).
    const { error } = await sb
      .from("orgs")
      .update({ settings: { ...org.settings, payments: { ...settings, provider: provider.id, account_id: accountId } } })
      .eq("id", org.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start onboarding." },
      { status: 500 },
    );
  }
}
