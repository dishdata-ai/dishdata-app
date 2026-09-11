import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { timingSafeEqual } from "@/lib/channels/types";
import {
  syncSumUpChannel, recordSyncError, SUMUP_CHANNEL_COLUMNS, type SumUpChannel,
} from "@/lib/channels/sumup";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/sumup-sync
 *
 * Sync every active SumUp channel — for a scheduler (Vercel Cron, Supabase
 * pg_cron + pg_net, cron-job.org, …), so stock keeps depleting even when
 * nobody has the Channels page open. Send `Authorization: Bearer $CRON_SECRET`.
 * With no CRON_SECRET configured the route is disabled rather than open.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(given, secret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 503 });

  const { data: channels, error } = await admin
    .from("channels")
    .select(SUMUP_CHANNEL_COLUMNS)
    .eq("provider", "sumup")
    .eq("is_active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sequential: SumUp rate-limits per key, and org counts here are small.
  const results = [];
  for (const ch of (channels ?? []) as SumUpChannel[]) {
    try {
      results.push({ channel_id: ch.id, ...(await syncSumUpChannel(admin, ch)) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "SumUp sync failed.";
      await recordSyncError(admin, ch.id, message);
      results.push({ channel_id: ch.id, error: message });
    }
  }
  return NextResponse.json({ channels: results.length, results });
}
