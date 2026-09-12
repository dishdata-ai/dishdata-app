import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { timingSafeEqual } from "@/lib/channels/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OpenEntry {
  id: string;
  org_id: string;
  clock_in: string;
  break_seconds: number;
  break_started_at: string | null;
}

/**
 * GET /api/cron/force-clockout
 *
 * Safety net for "forgot to clock out": My Day's geofence watch can end a
 * shift automatically when someone leaves the restaurant, but only while
 * their tab stays open in the foreground — see [[geo]]. This closes any
 * time_entries still open past org.max_shift_hours, regardless of location
 * or whether a browser is open anywhere. Run it hourly from a scheduler
 * (Vercel Cron, Supabase pg_cron + pg_net, cron-job.org, …) with
 * `Authorization: Bearer $CRON_SECRET`. Disabled (503) with no CRON_SECRET set.
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

  const { data: orgs, error: orgsErr } = await admin.from("orgs").select("id, max_shift_hours");
  if (orgsErr) return NextResponse.json({ error: orgsErr.message }, { status: 500 });
  const maxHoursByOrg = new Map((orgs ?? []).map((o) => [o.id as string, (o.max_shift_hours as number) ?? 14]));

  const { data: open, error: openErr } = await admin
    .from("time_entries")
    .select("id, org_id, clock_in, break_seconds, break_started_at")
    .is("clock_out", null);
  if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

  const now = Date.now();
  const closed: string[] = [];
  for (const entry of (open ?? []) as OpenEntry[]) {
    const maxHours = maxHoursByOrg.get(entry.org_id) ?? 14;
    const clockInMs = new Date(entry.clock_in).getTime();
    const cutoffMs = clockInMs + maxHours * 3600000;
    if (now < cutoffMs) continue;

    // Fold any still-running break in up to the cutoff, so the entry doesn't
    // read as having taken a multi-hour break it never actually ended.
    const breakStartMs = entry.break_started_at ? new Date(entry.break_started_at).getTime() : null;
    const breakSeconds = breakStartMs
      ? entry.break_seconds + Math.max(0, Math.floor((cutoffMs - breakStartMs) / 1000))
      : entry.break_seconds;

    const { error: updErr } = await admin
      .from("time_entries")
      .update({
        clock_out: new Date(cutoffMs).toISOString(),
        break_seconds: breakSeconds,
        break_started_at: null,
        auto_clock_out: true,
      })
      .eq("id", entry.id);
    if (!updErr) closed.push(entry.id);
  }

  return NextResponse.json({ checked: open?.length ?? 0, closed: closed.length, entry_ids: closed });
}
