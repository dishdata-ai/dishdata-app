"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Timer,
  Coffee,
  LogOut as ClockOutIcon,
  CalendarClock,
  Flame,
  KanbanSquare,
  ArrowRight,
  CheckCircle2,
  UserCircle2,
  Wallet,
  Play,
  CalendarCheck,
} from "lucide-react";
import { Card, SectionTitle, Badge, Button, EmptyState, PageSkeleton } from "@/components/ui";
import { AvailabilityPlanner } from "@/components/Availability";
import {
  useEmployees,
  useTimeEntries,
  useTasks,
  useOrders,
  useReservations,
  useAvailability,
  useInvalidate,
} from "@/lib/hooks/data";
import { dayKey, weekDays } from "@/lib/api/availability";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { useFmt } from "@/lib/hooks/useFmt";
import { clockIn, clockOut, toggleBreak, workedSeconds } from "@/lib/api/timeclock";
import { linkEmployeeToUser } from "@/lib/api/people";
import { updateTask } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/api/database.types";

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
              <Button
                className="w-full py-3 sm:w-auto sm:px-8"
                onClick={async () => {
                  try {
                    await clockIn(org!.id, me.id);
                    invalidate("time_entries");
                    toast.success("Clocked in", "Have a great shift!");
                  } catch (e) {
                    toast.error("Clock-in failed", e instanceof Error ? e.message : "");
                  }
                }}
              >
                <Timer className="h-5 w-5" /> Clock In
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* My week + today glance */}
      <div className={cn("grid gap-3", isAdmin ? "grid-cols-3" : "grid-cols-2")}>
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
      </div>

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
