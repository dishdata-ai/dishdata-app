import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when real Supabase credentials are present; false = demo mode (localStorage). */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (cookie-backed session so the SSR middleware can read it).
 * Only call from client components; repositories guard this via isSupabaseConfigured.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
    client = createBrowserClient(url!, anonKey!);
  }
  return client;
}
