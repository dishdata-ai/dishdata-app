import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Service-role Supabase client that bypasses RLS. Use ONLY in trusted server
 * contexts with no user session — e.g. Stripe webhooks marking an order paid.
 * Returns null when not configured (demo mode / missing service key).
 */
export function createSupabaseAdmin(): SupabaseClient | null {
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
