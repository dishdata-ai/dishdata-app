import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { timingSafeEqual } from "@/lib/channels/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OpenEntry {
  id: string;
  org_id: string;
  employee_id: string;
  clock_in: string;
  break_seconds: number;
  break_started_at: string | null;
}

interface Shift {
  employee_id: string;
  day: string;
  start_time: string;
  end_time: string;
}

// How long past a scheduled shift's end (or the org's max-hours cap) to wait
// before force-closing — long enough that closing side work or a genuinely
// running-over shift doesn't get cut off mid-service, short enough that
// "forgot to clock out" doesn't sit open for days.
const SHIFT_END_GRACE_MS = 30 * 60 * 1000;

/** UTC calendar date of a timestamp, as "YYYY-MM-DD" — matches how shifts.day is stored. */
function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The shift's end as an absolute timestamp, given its calendar day. Wraps to
 * the next day when end_time <= start_time (an overnight shift, e.g.
 * 17:00–01:00) — otherwise a closing shift would compute an end time before
 * its own start.
 */
function shiftEndMs(shift: Shift): number {
  const start = new Date(`${shift.day}T${shift.start_time}Z`).getTime();
  let end = new Date(`${shift.day}T${shift.end_time}Z`).getTime();
  if (end <= start) end += 86400000;
  return end;
}

/**
 * GET /api/cron/force-clockout
 *
 * Safety net for "forgot to clock out": My Day's geofence watch can end a
 * shift automatically when someone leaves the restaurant, but only while
 * their tab stays open in the foreground — see [[geo]]. This closes any
 * time_entries still open past whichever comes first — their scheduled
 * shift's end (see [[shifts]]), if they have one that day, or
 * org.max_shift_hours if they don't (or don't have one at all) — regardless
 * of location or whether a browser is open anywhere.
 *
 * Run it every 15–30 minutes from a scheduler (Vercel Cron, Supabase
 * pg_cron + pg_net, cron-job.org, …) with `Authorization: Bearer
 * $CRON_SECRET`. Disabled (503) with no CRON_SECRET set.
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
    .select("id, org_id, employee_id, clock_in, break_seconds, break_started_at")
    .is("clock_out", null);
  if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });
  const entries = (open ?? []) as OpenEntry[];
  if (entries.length === 0) return NextResponse.json({ checked: 0, closed: 0, entry_ids: [] });

  // One query covering every open entry's clock-in day (and the day before,
  // for an overnight shift whose `day` is technically "yesterday" relative
  // to a clock-in that landed just after midnight).
  const days = new Set<string>();
  for (const e of entries) {
    const d = utcDateKey(new Date(e.clock_in).getTime());
    days.add(d);
    days.add(utcDateKey(new Date(e.clock_in).getTime() - 86400000));
  }
  const { data: shiftRows, error: shiftsErr } = await admin
    .from("shifts")
    .select("employee_id, day, start_time, end_time")
    .in("day", [...days]);
  if (shiftsErr) return NextResponse.json({ error: shiftsErr.message }, { status: 500 });
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const s of (shiftRows ?? []) as Shift[]) {
    const list = shiftsByEmployee.get(s.employee_id) ?? [];
    list.push(s);
    shiftsByEmployee.set(s.employee_id, list);
  }

  const now = Date.now();
  const closed: string[] = [];
  for (const entry of entries) {
    const clockInMs = new Date(entry.clock_in).getTime();
    const maxHours = maxHoursByOrg.get(entry.org_id) ?? 14;
    const maxHoursCutoff = clockInMs + maxHours * 3600000;

    // The shift whose window actually contains this clock-in (allowing up to
    // an hour early), if any — at most one per employee per day today.
    const candidates = shiftsByEmployee.get(entry.employee_id) ?? [];
    const shift = candidates.find((s) => {
      const start = new Date(`${s.day}T${s.start_time}Z`).getTime();
      return clockInMs >= start - 3600000 && clockInMs <= shiftEndMs(s);
    });

    // Whichever bound actually applies and has been passed (plus grace) —
    // the shift's own end when they're scheduled, the org-wide cap otherwise.
    let dueAt: number | null = null;
    let closeAt: number | null = null;
    if (shift) {
      const end = shiftEndMs(shift);
      if (now >= end + SHIFT_END_GRACE_MS) {
        dueAt = end + SHIFT_END_GRACE_MS;
        closeAt = end;
      }
    }
    if (now >= maxHoursCutoff && (dueAt == null || maxHoursCutoff < dueAt)) {
      dueAt = maxHoursCutoff;
      closeAt = maxHoursCutoff;
    }
    if (dueAt == null || closeAt == null) continue;

    // Fold any still-running break in up to the cutoff, so the entry doesn't
    // read as having taken a multi-hour break it never actually ended.
    const breakStartMs = entry.break_started_at ? new Date(entry.break_started_at).getTime() : null;
    const breakSeconds = breakStartMs
      ? entry.break_seconds + Math.max(0, Math.floor((closeAt - breakStartMs) / 1000))
      : entry.break_seconds;

    const { error: updErr } = await admin
      .from("time_entries")
      .update({
        clock_out: new Date(closeAt).toISOString(),
        break_seconds: breakSeconds,
        break_started_at: null,
        auto_clock_out: true,
      })
      .eq("id", entry.id);
    if (!updErr) closed.push(entry.id);
  }

  return NextResponse.json({ checked: entries.length, closed: closed.length, entry_ids: closed });
}
