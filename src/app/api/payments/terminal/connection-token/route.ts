import { NextResponse, type NextRequest } from "next/server";
import { resolveActiveOrg } from "@/lib/payments/org-server";
import { getPaymentProvider, readPaymentsSettings } from "@/lib/payments";
import { isStripeConfigured } from "@/lib/payments/config";

/**
 * POST /api/payments/terminal/connection-token
 * Returns a short-lived Stripe Terminal connection token for the caller's org,
 * scoped to its connected account. Called by the mobile app (Bearer auth).
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured on the server." }, { status: 400 });
  }
  const res = await resolveActiveOrg(req);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const settings = readPaymentsSettings(res.value.org.settings);
  if (!settings.account_id || !settings.charges_enabled) {
    return NextResponse.json({ error: "This org has not connected Stripe payments." }, { status: 409 });
  }

  const provider = getPaymentProvider(settings);
  if (!provider.createConnectionToken) {
    return NextResponse.json({ error: "Provider does not support in-person payments." }, { status: 400 });
  }

  try {
    const secret = await provider.createConnectionToken(settings.account_id);
    return NextResponse.json({ secret });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not create connection token." },
      { status: 500 },
    );
  }
}
