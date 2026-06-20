import "server-only";
import Stripe from "stripe";
import { appUrl, applicationFeeAmount, isStripeConfigured } from "@/lib/payments/config";
import type {
  AccountStatus,
  CheckoutParams,
  CheckoutResult,
  OnboardingLink,
  PaymentProvider,
} from "@/lib/payments/types";

let stripe: Stripe | null = null;

/** Lazily build the platform Stripe client. Throws if the secret key is missing. */
export function getStripe(): Stripe {
  if (!isStripeConfigured()) {
    throw new Error("Stripe is not configured — set STRIPE_SECRET_KEY");
  }
  if (!stripe) {
    // No apiVersion pin: use the account's default to avoid SDK/type drift.
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripe;
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",

  async createOnboardingLink(orgId, existingAccountId): Promise<OnboardingLink> {
    const sc = getStripe();
    // Reuse the account if the merchant started but didn't finish onboarding.
    const accountId =
      existingAccountId ??
      (
        await sc.accounts.create({
          type: "express",
          metadata: { org_id: orgId },
        })
      ).id;

    const link = await sc.accountLinks.create({
      account: accountId,
      // Stripe sends the merchant back here; the page re-checks status.
      refresh_url: `${appUrl()}/api/payments/connect/return?account=${accountId}`,
      return_url: `${appUrl()}/api/payments/connect/return?account=${accountId}`,
      type: "account_onboarding",
    });
    return { accountId, url: link.url };
  },

  async getAccountStatus(accountId): Promise<AccountStatus> {
    const acct = await getStripe().accounts.retrieve(accountId);
    return {
      accountId,
      chargesEnabled: acct.charges_enabled ?? false,
      payoutsEnabled: acct.payouts_enabled ?? false,
      detailsSubmitted: acct.details_submitted ?? false,
    };
  },

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const sc = getStripe();
    const amountInCents = Math.round(params.amount * 100);
    const fee = applicationFeeAmount(amountInCents);

    // Direct charge: the connected account is the merchant of record, so it
    // bears Stripe's processing fee and we keep only the application fee.
    const session = await sc.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.currency.toLowerCase(),
              unit_amount: amountInCents,
              product_data: { name: params.description },
            },
          },
        ],
        payment_intent_data: {
          ...(fee > 0 ? { application_fee_amount: fee } : {}),
          metadata: { org_id: params.orgId, order_id: params.orderId },
        },
        metadata: { org_id: params.orgId, order_id: params.orderId },
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
      { stripeAccount: params.accountId },
    );

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url, sessionId: session.id };
  },
};
