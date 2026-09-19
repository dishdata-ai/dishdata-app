// Remembers a storefront visitor's email across visits (same browser, same
// device) so returning customers don't retype it on every order or rewards
// lookup. Deliberately not a real account/login — just a local convenience,
// same pattern as the language toggle. A real customer login (magic link,
// shared across a future Kokoland website) is separate follow-up work.

const KEY = "storefront-email";

export function getRememberedEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberEmail(email: string): void {
  try {
    if (email.trim()) localStorage.setItem(KEY, email.trim());
  } catch {
    // private browsing, etc. — the field just won't prefill next time
  }
}
