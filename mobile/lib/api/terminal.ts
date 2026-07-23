// Client for the DishData web backend's Stripe Terminal endpoints.
// Pure fetch — no native deps, so this is safe in Expo Go. The actual Tap to Pay
// orchestration (which DOES need a native dev-client build) lives in the Stripe
// Terminal SDK; see mobile/TAP_TO_PAY.md for the staged integration.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/** Base URL of the Next.js app exposing /api/payments/* (e.g. https://app.dishdata.de). */
const API_URL = process.env.EXPO_PUBLIC_API_URL;

async function authHeader(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured) throw new Error("Sign in required for payments");
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("No active session");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new Error("EXPO_PUBLIC_API_URL is not set");
  const res = await fetch(`${API_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: await authHeader(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

/** Fetch a short-lived Stripe Terminal connection token for the active org. */
export function fetchConnectionToken(): Promise<{ secret: string }> {
  return post("/api/payments/terminal/connection-token");
}

/** Create a card-present PaymentIntent for an existing order; returns its client secret. */
export function createTerminalIntent(orderId: string): Promise<{ intentId: string; clientSecret: string }> {
  return post("/api/payments/terminal/intent", { orderId });
}
