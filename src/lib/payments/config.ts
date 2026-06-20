// Shared payments configuration. Safe to import from both server and client
// (only reads NEXT_PUBLIC_* on the client; secret keys are read server-side).

/** App origin used to build Stripe redirect URLs (onboarding return, checkout success). */
export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/** Platform application fee in basis points (100 = 1%). Defaults to 0 = no fee. */
export function platformFeeBps(): number {
  const raw = Number(process.env.PLATFORM_FEE_BPS ?? "0");
  return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
}

/** Compute the application fee (in minor units / cents) for a given gross amount in cents. */
export function applicationFeeAmount(amountInCents: number): number {
  return Math.round((amountInCents * platformFeeBps()) / 10_000);
}

/** True when the platform's Stripe secret key is present (server-side only). */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}
