import "server-only";
import { stripeProvider } from "@/lib/payments/stripe";
import type { OrgPaymentsSettings, PaymentProvider, PaymentProviderId } from "@/lib/payments/types";

const PROVIDERS: Partial<Record<PaymentProviderId, PaymentProvider>> = {
  stripe: stripeProvider,
  // mollie: mollieProvider,   // future
  // vivid: vividProvider,     // future (Pay-by-Link / Adyen-backed acquiring)
};

/** Resolve the payment provider for an org. Defaults to Stripe. */
export function getPaymentProvider(settings?: OrgPaymentsSettings): PaymentProvider {
  const id = settings?.provider ?? "stripe";
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Payment provider "${id}" is not available`);
  return provider;
}

/** Read the payments block out of an org's settings jsonb. */
export function readPaymentsSettings(settings: Record<string, unknown> | null | undefined): OrgPaymentsSettings {
  return (settings?.payments as OrgPaymentsSettings | undefined) ?? {};
}

export type { OrgPaymentsSettings, PaymentProvider } from "@/lib/payments/types";
