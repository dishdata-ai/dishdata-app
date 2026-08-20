import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Resolve an authenticated Supabase client + user from the request.
 * Supports BOTH the web app (cookie session) and the mobile app, which sends
 * `Authorization: Bearer <supabase access token>`. Either way the returned
 * client carries the user's identity, so RLS and member-gated RPCs apply.
 */
export async function authClient(
  req: NextRequest,
): Promise<{ supabase: SupabaseClient; userId: string } | { error: string; status: number }> {
  const authz = req.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (authz?.startsWith("Bearer ")) {
    if (!url || !anon) return { error: "Backend not configured.", status: 400 };
    const token = authz.slice(7);
    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: authz } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) return { error: "Not authenticated.", status: 401 };
    return { supabase, userId: user.id };
  }

  const cookieClient = await createSupabaseServerClient();
  if (!cookieClient) return { error: "This requires a connected backend.", status: 400 };
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  if (!user) return { error: "Not authenticated.", status: 401 };
  return { supabase: cookieClient, userId: user.id };
}
