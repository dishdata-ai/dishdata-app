// Provider-agnostic payment contracts. Each org can connect its own merchant
// account (Stripe today; Mollie / Vivid can implement the same interface later).

/** Per-org payment connection state, persisted in orgs.settings.payments (jsonb). */
export interface OrgPaymentsSettings {
  provider?: PaymentProviderId;
  /** Connected account id, e.g. Stripe `acct_...`. */
  account_id?: string;
  /** Mirror of the provider's "can accept charges" flag, refreshed on status checks. */
  charges_enabled?: boolean;
  /** Whether the merchant finished onboarding (KYC, bank details, etc.). */
  details_submitted?: boolean;
}

export type PaymentProviderId = "stripe" | "mollie" | "vivid";

export interface OnboardingLink {
  /** The connected account id to persist against the org. */
  accountId: string;
  /** Hosted onboarding URL to redirect the merchant to. */
  url: string;
}

export interface AccountStatus {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export interface CheckoutParams {
  /** The merchant's connected account id (charge happens on their behalf). */
  accountId: string;
  orgId: string;
  orderId: string;
  /** Gross amount in major units (e.g. 42.50). */
  amount: number;
  /** ISO currency, e.g. "eur". */
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  /** Hosted payment page URL to redirect the customer to. */
  url: string;
  /** Provider session/intent id for reconciliation. */
  sessionId: string;
}

export interface PaymentProvider {
  id: PaymentProviderId;
  /** Begin (or resume) merchant onboarding; returns an account id + hosted URL. */
  createOnboardingLink(orgId: string, existingAccountId?: string): Promise<OnboardingLink>;
  /** Read the live capability/status of a connected account. */
  getAccountStatus(accountId: string): Promise<AccountStatus>;
  /** Create a hosted checkout for an order, charging the merchant's account with a platform fee. */
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
}
