"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Timer,
  Coffee,
  LogOut as ClockOutIcon,
  CalendarClock,
  CalendarDays,
  Flame,
  KanbanSquare,
  ArrowRight,
  CheckCircle2,
  UserCircle2,
  Wallet,
  Play,
  CalendarCheck,
  MapPin,
  Loader2,
  KeyRound,
  UtensilsCrossed,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Card, SectionTitle, Badge, Button, Input, EmptyState, PageSkeleton } from "@/components/ui";
import { AvailabilityPlanner } from "@/components/Availability";
import {
  useEmployees,
  useTimeEntries,
  useTasks,
  useOrders,
  useReservations,
  useAvailability,
  useShifts,
  useInvalidate,
} from "@/lib/hooks/data";
import { dayKey, weekDays, shortTime } from "@/lib/api/availability";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFmt } from "@/lib/hooks/useFmt";
import { clockIn, clockOut, toggleBreak, workedSeconds } from "@/lib/api/timeclock";
import { linkEmployeeToUser, setMyPin } from "@/lib/api/people";
import { getStaffMealUsage } from "@/lib/api/orders";
import { updateTask } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import { getCurrentPosition, distanceMeters, geofenceOf, GeoError } from "@/lib/geo";
import type { Task } from "@/lib/api/database.types";

// While clocked in and the org has a geofence, if a position fix lands
// outside the radius continuously for this long, clock them out automatically.
// Short enough to catch "walked home and forgot", long enough that one bad
// GPS reading at the edge of the lot doesn't end their shift by itself.
const AUTO_CLOCKOUT_GRACE_MS = 10 * 60 * 1000;

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Self-serve PIN, set by the employee — not a manager. A PIN someone picks
 * themselves gets remembered; one assigned once during onboarding and never
 * mentioned again doesn't, which just means the features that need it
 * (staff meal self-serve, approving a staff discount) quietly stop getting
 * used. Only ever touches this employee's own row, via set_my_pin (0049).
 */
function MyPinCard({ orgId, employeeId, hasPin }: { orgId: string; employeeId: string; hasPin: boolean }) {
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (pin.trim().length < 4) {
      toast.error("PIN needs to be at least 4 digits");
      return;
    }
    setSaving(true);
    try {
      await setMyPin(orgId, employeeId, pin);
      invalidate("employees");
      toast.success("PIN saved");
      setEditing(false);
      setPin("");
    } catch (e) {
      toast.error("Could not save PIN", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-white/[0.03] p-2">
          <KeyRound className="h-4 w-4 text-accent-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white">My PIN</p>
          <p className="text-xs text-zinc-500">Used to claim a staff meal or approve a discount at the till.</p>
        </div>
        <Badge tone={hasPin ? "green" : "amber"}>{hasPin ? "Set" : "Not set"}</Badge>
      </div>
      {editing ? (
        <div className="mt-3 flex gap-2">
          <Input
            type="password"
            inputMode="numeric"
            placeholder="New PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            maxLength={8}
            className="flex-1"
            autoFocus
          />
          <Button disabled={saving} onClick={save}>
            Save
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => { setEditing(false); setPin(""); }}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="ghost" className="mt-3 w-full text-xs" onClick={() => setEditing(true)}>
          {hasPin ? "Change PIN" : "Set a PIN"}
        </Button>
      )}
    </Card>
  );
}

export function MyDayView() {
  // Hours and pay are hidden from staff for now — admins still see their own.
  const { org, moduleIds, isAdmin } = useOrg();
  const { user } = useAuth();
  const fmt = useFmt();
  const invalidate = useInvalidate();
  const employeesQ = useEmployees();
  const entriesQ = useTimeEntries();
  const tasksQ = useTasks();
  const ordersQ = useOrders();
  const reservationsQ = useReservations();
  const availabilityQ = useAvailability();
  const shiftsQ = useShifts();
  const [clockingIn, setClockingIn] = useState(false);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const employees = (employeesQ.data ?? []).filter((e) => e.is_active);
  const me = employees.find((e) => e.user_id === user?.id) ?? null;
  // Only employees nobody has claimed yet belong in the self-link picker
  // below — showing every active employee let anyone without a link click a
  // co-worker's already-claimed name and take over their profile (their
  // hours, pay, shifts), silently unlinking that co-worker in the process.
  const unclaimedEmployees = employees.filter((e) => !e.user_id);

  const myOpenEntry = useMemo(
    () => (me ? (entriesQ.data ?? []).find((e) => e.employee_id === me.id && !e.clock_out) : undefined),
    [entriesQ.data, me],
  );

  const myWeek = useMemo(() => {
    if (!me) return { hours: 0, earnings: 0, shifts: 0 };
    const weekAgo = Date.now() - 7 * 86400000;
    let seconds = 0;
    let shifts = 0;
    for (const e of entriesQ.data ?? []) {
      if (e.employee_id !== me.id || new Date(e.clock_in).getTime() < weekAgo) continue;
      seconds += workedSeconds(e, now);
      shifts += 1;
    }
    return { hours: seconds / 3600, earnings: (seconds / 3600) * me.hourly_rate, shifts };
  }, [entriesQ.data, me, now]);

  // Employee tasks (roster assignment) + partner tasks assigned to this user directly.
  const myTasks = useMemo(
    () =>
      (tasksQ.data ?? [])
        .filter(
          (t) =>
            t.status !== "done" &&
            ((me && t.assignee_employee_id === me.id) || (user && t.assignee_user_id === user.id)),
        )
        .sort((a, b) => (a.priority === "high" ? -1 : b.priority === "high" ? 1 : 0)),
    [tasksQ.data, me, user],
  );

  const nextWeekFilled = useMemo(() => {
    if (!me) return 0;
    const keys = new Set(weekDays(1).map(dayKey));
    return (availabilityQ.data ?? []).filter((r) => r.employee_id === me.id && keys.has(r.day)).length;
  }, [availabilityQ.data, me]);

  const myShifts = useMemo(() => {
    if (!me) return [];
    const today = dayKey(new Date());
    return (shiftsQ.data ?? [])
      .filter((s) => s.employee_id === me.id && s.day >= today)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(0, 6);
  }, [shiftsQ.data, me]);

  const geofence = org ? geofenceOf(org) : null;

  const mealEnabled = (org?.staff_meal_daily_limit ?? 0) > 0;
  const mealUsageQ = useQuery({
    queryKey: ["staffMealUsage", org?.id, me?.id],
    queryFn: () => getStaffMealUsage(org!.id, me!.id),
    enabled: !!org?.id && !!me?.id && mealEnabled,
  });

  // Best-effort "forgot to clock out": while on shift and the org has a
  // geofence, watch position and clock out if we're outside it for a while.
  // This only runs while this tab stays open in the foreground — closing the
  // browser or locking the phone stops it, same as any web page. The
  // force-clockout cron is the backstop for that gap.
  const outsideSinceRef = useRef<number | null>(null);
  const autoClockedRef = useRef(false);
  useEffect(() => {
    if (!myOpenEntry || !geofence || !org || !me) return;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    outsideSinceRef.current = null;
    autoClockedRef.current = false;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (autoClockedRef.current) return;
        const d = distanceMeters({ lat: pos.coords.latitude, lng: pos.coords.longitude }, geofence);
        if (d <= geofence.radiusM) {
          outsideSinceRef.current = null;
          return;
        }
        if (outsideSinceRef.current == null) {
          outsideSinceRef.current = Date.now();
          return;
        }
        if (Date.now() - outsideSinceRef.current >= AUTO_CLOCKOUT_GRACE_MS) {
          autoClockedRef.current = true;
          clockOut(org.id, myOpenEntry, { lat: pos.coords.latitude, lng: pos.coords.longitude, auto: true })
            .then(() => {
              invalidate("time_entries");
              toast.error("Clocked out automatically", "You left the restaurant's location while on shift.");
            })
            .catch(() => {
              autoClockedRef.current = false; // let it retry on the next fix
            });
        }
      },
      () => {}, // a transient GPS error just skips this fix; no need to surface it
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myOpenEntry?.id, geofence?.lat, geofence?.lng, geofence?.radiusM]);

  const kitchenOpen =(ordersQ.data ?? []).filter(
    (o) => o.kitchen_status !== "served" && o.status !== "void" &&
      Date.now() - new Date(o.created_at).getTime() < 12 * 3600000,
  ).length;

  const todayReservations = useMemo(() => {
    const key = new Date().toISOString().slice(0, 10);
    return (reservationsQ.data ?? []).filter(
      (r) => r.starts_at.slice(0, 10) === key && (r.status === "booked" || r.status === "seated"),
    );
  }, [reservationsQ.data]);

  const advanceTask = async (t: Task) => {
    const next = t.status === "todo" ? "in_progress" : "done";
    try {
      await updateTask(org!.id, t.id, { status: next });
      invalidate("tasks");
      if (next === "done") toast.success("Task done", t.title);
    } catch (e) {
      toast.error("Could not update task", e instanceof Error ? e.message : "");
    }
  };

  if (employeesQ.isLoading || entriesQ.isLoading) return <PageSkeleton />;

  // Not linked yet → self-service "this is me" picker
  if (!me) {
    return (
      <Card className="p-6">
        <div className="mb-5 text-center">
          <UserCircle2 className="mx-auto mb-2 h-10 w-10 text-brand-300" />
          <h3 className="font-display text-xl font-bold text-white">Who are you?</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Pick your name once — your shifts, tasks and hours will show up here.
          </p>
        </div>
        {unclaimedEmployees.length === 0 ? (
          <EmptyState
            title="No unclaimed profiles"
            hint="Every employee here is already linked to an account — ask a manager to check the Staff module."
          />
        ) : (
          <div className="mx-auto grid max-w-lg gap-2 sm:grid-cols-2">
            {unclaimedEmployees.map((emp) => (
              <button
                key={emp.id}
                onClick={async () => {
                  try {
                    await linkEmployeeToUser(org!.id, emp.id, user!.id);
                    invalidate("employees");
                    toast.success(`Welcome, ${emp.name.split(" ")[0]}!`, "Your day is ready");
                  } catch (e) {
                    toast.error("Could not link profile", e instanceof Error ? e.message : "");
                  }
                }}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-3 text-left transition-all hover:border-brand-400/40"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-zinc-950"
                  style={{ background: `linear-gradient(135deg, hsl(${emp.avatar_hue} 70% 65%), hsl(${emp.avatar_hue + 40} 70% 55%))` }}
                >
                  {emp.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{emp.name}</p>
                  <p className="text-xs text-zinc-500">{emp.role_title}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
    );
  }

  const onBreak = !!myOpenEntry?.break_started_at;

  return (
    <div className="space-y-4">
      {/* Hero: greeting + current shift */}
      <Card className="overflow-hidden p-0">
        <div className="bg-gradient-to-br from-brand-500/15 via-transparent to-accent-400/10 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-zinc-950"
              style={{ background: `linear-gradient(135deg, hsl(${me.avatar_hue} 70% 65%), hsl(${me.avatar_hue + 40} 70% 55%))` }}
            >
              {me.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-bold text-white sm:text-2xl">
                {greeting()}, {me.name.split(" ")[0]} 👋
              </p>
              <p className="text-sm text-zinc-400">
                {me.role_title}
                {me.shift_note ? ` · ${me.shift_note}` : ""}
              </p>
            </div>
            {myOpenEntry ? (
              <Badge tone={onBreak ? "amber" : "green"}>{onBreak ? "On break" : "On shift"}</Badge>
            ) : (
              <Badge tone="neutral">Off shift</Badge>
            )}
          </div>

          <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {myOpenEntry ? (
              <>
                <div className="flex-1 text-center sm:text-left">
                  <p className="font-display text-gradient text-4xl font-bold tabular-nums">
                    {fmtDuration(workedSeconds(myOpenEntry, now))}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    on the clock since{" "}
                    {new Date(myOpenEntry.clock_in).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    {myOpenEntry.break_seconds > 0 || onBreak
                      ? ` · breaks ${Math.round(myOpenEntry.break_seconds / 60)}m`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await toggleBreak(org!.id, myOpenEntry);
                      invalidate("time_entries");
                    }}
                  >
                    <Coffee className="h-4 w-4" /> {onBreak ? "End break" : "Take a break"}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      const worked = fmtDuration(workedSeconds(myOpenEntry, now));
                      await clockOut(org!.id, myOpenEntry);
                      invalidate("time_entries");
                      toast.success("Clocked out", `${worked} worked — see you next shift!`);
                    }}
                  >
                    <ClockOutIcon className="h-4 w-4" /> Clock out
                  </Button>
                </div>
              </>
            ) : (
              <div className="w-full sm:w-auto">
                <Button
                  className="w-full py-3 sm:px-8"
                  disabled={clockingIn}
                  onClick={async () => {
                    setClockingIn(true);
                    try {
                      if (geofence) {
                        let pos;
                        try {
                          pos = await getCurrentPosition();
                        } catch (e) {
                          const reason = e instanceof GeoError ? e.message : "Couldn't check your location.";
                          toast.error("Clock-in needs your location", `${reason} Ask a manager to clock you in on Time Clock.`);
                          return;
                        }
                        const distanceM = distanceMeters(pos, geofence);
                        if (distanceM > geofence.radiusM) {
                          toast.error(
                            "You're not at the restaurant",
                            `${Math.round(distanceM)}m away — ask a manager to clock you in on Time Clock.`,
                          );
                          return;
                        }
                        await clockIn(org!.id, me.id, { lat: pos.lat, lng: pos.lng, distanceM });
                      } else {
                        await clockIn(org!.id, me.id);
                      }
                      invalidate("time_entries");
                      toast.success("Clocked in", "Have a great shift!");
                    } catch (e) {
                      toast.error("Clock-in failed", errorMessage(e));
                    } finally {
                      setClockingIn(false);
                    }
                  }}
                >
                  {clockingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : <Timer className="h-5 w-5" />}
                  {clockingIn ? "Checking location…" : "Clock In"}
                </Button>
                {geofence && (
                  <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-zinc-500 sm:justify-start">
                    <MapPin className="h-3 w-3" /> Checks you're at the restaurant
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* My week + today glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {isAdmin && (
          <>
            <Card className="p-4 text-center">
              <Timer className="mx-auto h-4 w-4 text-brand-300" />
              <p className="mt-1.5 font-display text-lg font-bold text-white">{myWeek.hours.toFixed(1)}h</p>
              <p className="text-[11px] text-zinc-500">this week · {myWeek.shifts} shifts</p>
            </Card>
            <Card className="p-4 text-center">
              <Wallet className="mx-auto h-4 w-4 text-accent-400" />
              <p className="mt-1.5 font-display text-lg font-bold text-white">{fmt(myWeek.earnings)}</p>
              <p className="text-[11px] text-zinc-500">earned this week</p>
            </Card>
          </>
        )}
        <Card className="p-4 text-center">
          <KanbanSquare className="mx-auto h-4 w-4 text-violet-soft" />
          <p className="mt-1.5 font-display text-lg font-bold text-white">{myTasks.length}</p>
          <p className="text-[11px] text-zinc-500">open tasks</p>
        </Card>
        {!isAdmin && (
          <a href="#availability">
            <Card className="h-full p-4 text-center transition-all hover:border-brand-400/40">
              <CalendarCheck className="mx-auto h-4 w-4 text-accent-400" />
              <p className="mt-1.5 font-display text-lg font-bold text-white">{nextWeekFilled}/7</p>
              <p className="text-[11px] text-zinc-500">next week's availability</p>
            </Card>
          </a>
        )}
        {/* Balance only, no claim action here — actually claiming a meal happens
            at POS, the only screen with a cart, kitchen ticket and inventory
            linkage. This just tells you where you stand before you get there. */}
        {mealEnabled && (
          <Card className="p-4 text-center">
            <UtensilsCrossed className="mx-auto h-4 w-4 text-brand-300" />
            <p className="mt-1.5 font-display text-lg font-bold text-white">
              {mealUsageQ.data ? fmt(mealUsageQ.data.remaining) : "—"}
            </p>
            <p className="text-[11px] text-zinc-500">meal allowance left today</p>
          </Card>
        )}
      </div>

      {/* My upcoming shifts */}
      <Card>
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">My Shifts</h3>
            <p className="text-xs text-zinc-500">What your manager has scheduled you for</p>
          </div>
        </div>
        {myShifts.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Nothing scheduled yet"
            hint="Shifts your manager assigns show up here."
            className="py-6"
          />
        ) : (
          <div className="divide-y divide-line/60">
            {myShifts.map((s) => {
              const d = new Date(`${s.day}T00:00:00`);
              const isToday = s.day === dayKey(new Date());
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-16 shrink-0">
                    <p className={cn("text-sm font-semibold", isToday ? "text-brand-300" : "text-white")}>
                      {isToday ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })}
                    </p>
                    <p className="text-xs text-zinc-500">{d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">
                      {shortTime(s.start_time)}–{shortTime(s.end_time)}
                    </p>
                    {(s.role_title || s.note) && (
                      <p className="truncate text-xs text-zinc-500">
                        {[s.role_title, s.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <MyPinCard orgId={org!.id} employeeId={me.id} hasPin={!!me.pin} />

      {/* My tasks */}
      <Card>
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">My Tasks</h3>
            <p className="text-xs text-zinc-500">Assigned to you</p>
          </div>
          {moduleIds.has("tasks") && (
            <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline">
              Board <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
        {myTasks.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            hint="Tasks assigned to you appear here."
            className="py-8"
          />
        ) : (
          <div className="divide-y divide-line/60">
            {myTasks.map((t) => {
              const overdue = t.due_date && new Date(t.due_date) < new Date();
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge tone={t.priority === "high" ? "rose" : t.priority === "medium" ? "amber" : "neutral"} className="shrink-0 capitalize">
                    {t.priority}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{t.title}</p>
                    <p className="text-xs text-zinc-500">
                      {t.status === "in_progress" ? "In progress" : "To do"}
                      {t.due_date && (
                        <span className={cn(overdue && "font-semibold text-rose-soft")}>
                          {" · due "}
                          {new Date(t.due_date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button className="shrink-0 px-3 py-1.5 text-xs" onClick={() => advanceTask(t)}>
                    {t.status === "todo" ? (
                      <>
                        <Play className="h-3 w-3" /> Start
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3" /> Done
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div id="availability" className="scroll-mt-4">
        <AvailabilityPlanner employee={me} />
      </div>

      {/* Today at the restaurant */}
      <div className="grid gap-3 sm:grid-cols-2">
        {moduleIds.has("kitchen") && (
          <Link href="/kitchen">
            <Card className="flex items-center gap-3 p-4 transition-all hover:border-brand-400/40">
              <div className="rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-400/10 p-2.5">
                <Flame className="h-5 w-5 text-brand-300" />
              </div>
              <div>
                <p className="font-semibold text-white">Kitchen queue</p>
                <p className="text-xs text-zinc-500">
                  {kitchenOpen === 0 ? "Line is clear" : `${kitchenOpen} open ticket${kitchenOpen > 1 ? "s" : ""}`}
                </p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-zinc-600" />
            </Card>
          </Link>
        )}
        {moduleIds.has("floor") && (
          <Link href="/floor">
            <Card className="flex items-center gap-3 p-4 transition-all hover:border-brand-400/40">
              <div className="rounded-xl bg-gradient-to-br from-violet-soft/20 to-accent-400/10 p-2.5">
                <CalendarClock className="h-5 w-5 text-violet-soft" />
              </div>
              <div>
                <p className="font-semibold text-white">Today's reservations</p>
                <p className="text-xs text-zinc-500">
                  {todayReservations.length === 0
                    ? "None booked"
                    : `${todayReservations.length} — next: ${todayReservations[0].guest_name} at ${new Date(todayReservations[0].starts_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
                </p>
              </div>
              <ArrowRight className="ml-auto h-4 w-4 text-zinc-600" />
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function MyDay() {
  return (
    <div className="space-y-6">
      <SectionTitle title="My Day" subtitle="Your shift, your tasks, your hours — all in one place." />
      <MyDayView />
    </div>
  );
}
