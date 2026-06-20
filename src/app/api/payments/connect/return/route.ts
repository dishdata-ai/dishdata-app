import { NextResponse } from "next/server";
import { appUrl } from "@/lib/payments/config";

/**
 * GET /api/payments/connect/return
 * Stripe redirects here after the merchant finishes (or abandons) onboarding.
 * We bounce back to Settings; the page re-checks live status via /status.
 */
export async function GET() {
  return NextResponse.redirect(`${appUrl()}/settings?payments=connected`);
}
