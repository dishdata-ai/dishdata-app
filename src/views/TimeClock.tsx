import { useEffect, useMemo, useState } from "react";
<<<<<<< HEAD
import {
  Timer, Coffee, LogOut as ClockOutIcon, BadgeDollarSign, Users, MapPin, MapPinOff, Pencil,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { Card, SectionTitle, StatCard, Badge, Button, Input, Field, Modal, EmptyState, PageSkeleton, Table, WeekTabs } from "@/components/ui";
=======
import { Timer, Coffee, LogOut as ClockOutIcon, BadgeDollarSign, Users, MapPin, MapPinOff, Pencil } from "lucide-react";
import { Card, SectionTitle, StatCard, Badge, Button, Input, Field, Modal, EmptyState, PageSkeleton, Table } from "@/components/ui";
>>>>>>> origin/main
import { useEmployees, useTimeEntries, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { clockIn, clockOut, toggleBreak, workedSeconds, editTimeEntry } from "@/lib/api/timeclock";
<<<<<<< HEAD
import { dayKey, weekDays, weekLabel } from "@/lib/api/availability";
import { geofenceOf, type Geofence } from "@/lib/geo";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { Employee, TimeEntry } from "@/lib/api/database.types";

function timesheetWeekLabel(offset: number): string {
  if (offset === 0) return "This week";
  if (offset === -1) return "Last week";
  return weekLabel(weekDays(offset));
}

/**
 * Hours/cost/flags for one calendar week (Monday–Sunday), scoped to a set of
 * employees — shared by the always-current overview cards (offset 0, fixed)
 * and the browsable timesheet below (offset = whatever week is selected).
 * Local day-keys, not raw ISO slicing — matches how Availability.tsx safely
 * assigns an entry's clock-in to a calendar day.
 */
function statsForWeek(
  entries: TimeEntry[],
  employees: Employee[],
  geofence: Geofence | null,
  now: number,
  offset: number,
) {
  const keys = new Set(weekDays(offset).map(dayKey));
  const map = new Map<string, { seconds: number; cost: number; offSite: number; autoOut: number }>();
  for (const e of entries) {
    if (!keys.has(dayKey(new Date(e.clock_in)))) continue;
    const emp = employees.find((x) => x.id === e.employee_id);
    if (!emp) continue;
    const secs = workedSeconds(e, now);
    const prev = map.get(emp.id) ?? { seconds: 0, cost: 0, offSite: 0, autoOut: 0 };
    prev.seconds += secs;
    prev.cost += (secs / 3600) * emp.hourly_rate;
    if (geofence && e.clock_in_distance_m != null && e.clock_in_distance_m > geofence.radiusM) prev.offSite += 1;
    if (e.auto_clock_out) prev.autoOut += 1;
    map.set(emp.id, prev);
  }
  return map;
}
=======
import { geofenceOf } from "@/lib/geo";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { TimeEntry } from "@/lib/api/database.types";
>>>>>>> origin/main

/** <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in LOCAL time, not the UTC ISO string we store. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Manager+ correction for one entry — a stuck-open shift (clock_out never
 * set, sometimes for days once the auto-clockout cron wasn't wired up yet),
 * or an honestly wrong time. See edit_time_entry (0050): this is the only
 * write path into time_entries besides the self-service clock RPCs.
 */
function EditEntryModal({
  orgId,
  entry,
  employeeName,
  onClose,
  onSaved,
}: {
  orgId: string;
  entry: TimeEntry;
  employeeName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clockInAt, setClockInAt] = useState(toLocalInput(entry.clock_in));
  const [clockOutAt, setClockOutAt] = useState(entry.clock_out ? toLocalInput(entry.clock_out) : "");
  const [breakMin, setBreakMin] = useState(String(Math.round(entry.break_seconds / 60)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!clockInAt) {
      toast.error("Clock-in time is required");
      return;
    }
    const clockInIso = new Date(clockInAt).toISOString();
    const clockOutIso = clockOutAt ? new Date(clockOutAt).toISOString() : null;
    if (clockOutIso && clockOutIso <= clockInIso) {
      toast.error("Clock-out must be after clock-in");
      return;
    }
    setSaving(true);
    try {
      await editTimeEntry(orgId, entry.id, {
        clockIn: clockInIso,
        clockOut: clockOutIso,
        breakSeconds: (+breakMin || 0) * 60,
      });
      onSaved();
      toast.success("Time entry updated");
      onClose();
    } catch (e) {
      toast.error("Could not update", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit shift · ${employeeName}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clock in">
            <Input type="datetime-local" value={clockInAt} onChange={(e) => setClockInAt(e.target.value)} />
          </Field>
          <Field label="Clock out">
            <Input
              type="datetime-local"
              value={clockOutAt}
              onChange={(e) => setClockOutAt(e.target.value)}
              placeholder="Still open"
            />
          </Field>
        </div>
        <Field label="Break (minutes)">
          <Input type="number" min="0" step="5" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} />
        </Field>
        {!clockOutAt && (
          <p className="text-xs text-amber-300">Leaving clock-out empty keeps this shift open.</p>
        )}
        <Button className="w-full" disabled={saving} onClick={save}>
          Save changes
        </Button>
      </div>
    </Modal>
  );
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export default function TimeClock() {
  const { org, role, isManager } = useOrg();
  const fmt = useFmt();
  const employeesQ = useEmployees();
  const entriesQ = useTimeEntries();
  const invalidate = useInvalidate();
  // Wages and labor cost are manager+ only — staff shouldn't see coworkers' pay.
  const canSeeWages = role !== "staff";
  const [editing, setEditing] = useState<{ entry: TimeEntry; employeeName: string } | null>(null);
<<<<<<< HEAD
  // The overview cards above always mean the actual current week; only the
  // timesheet below is browsable, so paging through an old week never makes
  // "hours right now" look like it changed.
  const [weekOffset, setWeekOffset] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
=======
>>>>>>> origin/main

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const employees = (employeesQ.data ?? []).filter((e) => e.is_active);
  const entries = entriesQ.data ?? [];
  const openEntries = entries.filter((e) => !e.clock_out);
  const openByEmployee = new Map(openEntries.map((e) => [e.employee_id, e]));

  // Distance is checked against the org's CURRENT radius — geofence settings
  // rarely change, and re-deriving it per entry isn't worth storing the
  // radius on every row just to handle the rare case where it did.
  const geofence = org ? geofenceOf(org) : null;

  const currentWeekStats = useMemo(
    () => statsForWeek(entries, employees, geofence, now, 0),
    [entries, employees, geofence, now],
  );
  const weekStats = useMemo(
    () => (weekOffset === 0 ? currentWeekStats : statsForWeek(entries, employees, geofence, now, weekOffset)),
    [entries, employees, geofence, now, weekOffset, currentWeekStats],
  );
  const weekDayKeys = useMemo(() => new Set(weekDays(weekOffset).map(dayKey)), [weekOffset]);

  const totalWeekCost = [...currentWeekStats.values()].reduce((s, v) => s + v.cost, 0);
  const totalWeekHours = [...currentWeekStats.values()].reduce((s, v) => s + v.seconds, 0) / 3600;

  const doClockIn = async (employeeId: string) => {
    try {
      await clockIn(org!.id, employeeId);
      invalidate("time_entries");
      toast.success("Clocked in", "Have a good shift!");
    } catch (e) {
      toast.error("Clock-in failed", e instanceof Error ? e.message : "");
    }
  };

  if (employeesQ.isLoading || entriesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Time Clock"
        subtitle="Clock in and out, track breaks — hours feed labor cost in Finance."
      />

      <div className={cn("grid gap-4", canSeeWages ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        <StatCard title="On the Clock" value={String(openEntries.length)} hint="right now" icon={Timer} />
        <StatCard title="Hours This Week" value={totalWeekHours.toFixed(1)} hint="tracked across the team" icon={Users} />
        {canSeeWages && (
          <StatCard title="Labor Cost" value={fmt(totalWeekCost)} hint="this week" icon={BadgeDollarSign} />
        )}
      </div>

      {employees.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No employees yet" hint="Add your team in the Staff module first." />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((emp) => {
            const open = openByEmployee.get(emp.id);
            const onBreak = !!open?.break_started_at;
            return (
              <Card key={emp.id} className={cn("p-4", open && "border-brand-400/30")}>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-zinc-950"
                    style={{
                      background: `linear-gradient(135deg, hsl(${emp.avatar_hue} 70% 65%), hsl(${emp.avatar_hue + 40} 70% 55%))`,
                    }}
                  >
                    {emp.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-white">{emp.name}</p>
                    <p className="text-xs text-zinc-500">{emp.role_title}</p>
                  </div>
                  {open ? (
                    <Badge tone={onBreak ? "amber" : "green"}>{onBreak ? "On break" : "Working"}</Badge>
                  ) : (
                    <Badge tone="neutral">Off</Badge>
                  )}
                </div>

                {open ? (
                  <>
                    <div className="mt-4 text-center">
                      <p className="font-display text-3xl font-bold text-gradient tabular-nums">
                        {fmtDuration(workedSeconds(open, now))}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        since {new Date(open.clock_in).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {open.break_seconds > 0 || onBreak ? ` · breaks ${fmtDuration(open.break_seconds)}` : ""}
                      </p>
                      {/* Only surfaced when there's something to flag — an ordinary
                          on-site clock-in (or no geofence configured) stays quiet. */}
                      {geofence && open.clock_in_distance_m != null && open.clock_in_distance_m > geofence.radiusM && (
                        <p className="mt-1 flex items-center justify-center gap-1 text-xs text-amber-300">
                          <MapPinOff className="h-3 w-3" /> {Math.round(open.clock_in_distance_m)}m away at clock-in
                        </p>
                      )}
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <Button
                        variant="ghost"
                        className="py-2 text-xs"
                        onClick={async () => {
                          await toggleBreak(org!.id, open);
                          invalidate("time_entries");
                        }}
                      >
                        <Coffee className="h-3.5 w-3.5" /> {onBreak ? "End break" : "Break"}
                      </Button>
                      <Button
                        variant="danger"
                        className="py-2 text-xs"
                        onClick={async () => {
                          await clockOut(org!.id, open);
                          invalidate("time_entries");
                          toast.success(`${emp.name} clocked out`, fmtDuration(workedSeconds(open, now)) + " worked");
                        }}
                      >
                        <ClockOutIcon className="h-3.5 w-3.5" /> Clock out
                      </Button>
                    </div>
                    {isManager && (
                      <button
                        onClick={() => setEditing({ entry: open, employeeName: emp.name })}
                        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1 py-1 text-xs text-zinc-500 hover:text-white"
                      >
                        <Pencil className="h-3 w-3" /> Fix the times
                      </button>
                    )}
                  </>
                ) : (
                  <Button className="mt-4 w-full py-2" onClick={() => doClockIn(emp.id)}>
                    <Timer className="h-4 w-4" /> Clock In
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">Timesheet</h3>
            <p className="text-xs text-zinc-500">
              {canSeeWages ? "Tracked hours and labor cost per person" : "Tracked hours per person"} ·{" "}
              {weekLabel(weekDays(weekOffset))}
            </p>
          </div>
          <WeekTabs offsets={[0, -1, -2, -3]} value={weekOffset} onChange={setWeekOffset} label={timesheetWeekLabel} />
        </div>
        {weekStats.size === 0 ? (
          <EmptyState
            icon={Timer}
            title="No hours tracked"
            hint={weekOffset === 0 ? "Clock someone in to start the timesheet." : "Nobody clocked in during this week."}
          />
        ) : (
          <Table
            headers={[
              "", "Employee", "Hours",
              ...(canSeeWages ? ["Rate", "Labor Cost"] : []),
              "Shifts", "Flags",
              ...(isManager ? [""] : []),
            ]}
          >
            {employees
              .filter((e) => weekStats.has(e.id))
              .flatMap((emp) => {
                const stat = weekStats.get(emp.id)!;
<<<<<<< HEAD
                const weekEntries = entries
                  .filter((e) => e.employee_id === emp.id && weekDayKeys.has(dayKey(new Date(e.clock_in))))
                  // Most recent first — what someone's most likely to want to check first.
                  .sort((a, b) => b.clock_in.localeCompare(a.clock_in));
                const isOpen = expanded.has(emp.id);

                const summaryRow = (
=======
                const weekEntries = entries.filter(
                  (e) => e.employee_id === emp.id && new Date(e.clock_in).getTime() > Date.now() - 7 * 86400000,
                );
                const shifts = weekEntries.length;
                // Most recent first — the one someone's most likely to need
                // corrected right after noticing something's off.
                const latestEntry = [...weekEntries].sort((a, b) => b.clock_in.localeCompare(a.clock_in))[0];
                return (
>>>>>>> origin/main
                  <tr key={emp.id} className="hover:bg-white/[0.02]">
                    <td className="px-2 py-3">
                      <button
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(emp.id)) next.delete(emp.id);
                            else next.add(emp.id);
                            return next;
                          })
                        }
                        className="cursor-pointer text-zinc-500 hover:text-white"
                        title={isOpen ? "Hide shifts" : `Show ${weekEntries.length} shift${weekEntries.length > 1 ? "s" : ""}`}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{emp.name}</td>
                    <td className="px-4 py-3 text-zinc-300">{(stat.seconds / 3600).toFixed(1)}h</td>
                    {canSeeWages && (
                      <>
                        <td className="px-4 py-3 text-zinc-400">{fmt(emp.hourly_rate, 2)}/h</td>
                        <td className="px-4 py-3 font-medium text-zinc-200">{fmt(stat.cost, 2)}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-zinc-400">{weekEntries.length}</td>
                    <td className="px-4 py-3">
                      {stat.offSite === 0 && stat.autoOut === 0 ? (
                        <span className="text-zinc-600">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs text-amber-300">
                          {stat.offSite > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <MapPinOff className="h-3 w-3" /> {stat.offSite} off-site
                            </span>
                          )}
                          {stat.autoOut > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {stat.autoOut} auto clock-out
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 text-right">
<<<<<<< HEAD
                        {weekEntries[0] && (
                          <button
                            onClick={() => setEditing({ entry: weekEntries[0], employeeName: emp.name })}
=======
                        {latestEntry && (
                          <button
                            onClick={() => setEditing({ entry: latestEntry, employeeName: emp.name })}
>>>>>>> origin/main
                            className="cursor-pointer text-zinc-500 hover:text-white"
                            title="Fix their most recent shift"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );

                if (!isOpen) return [summaryRow];

                // Expanded: every individual shift that week, each editable on
                // its own — not just the one the quick pencil above reaches.
                const detailRows = weekEntries.map((e) => {
                  const off = geofence && e.clock_in_distance_m != null && e.clock_in_distance_m > geofence.radiusM;
                  const d = new Date(e.clock_in);
                  return (
                    <tr key={e.id} className="bg-white/[0.015] text-xs">
                      <td className="px-2 py-2" />
                      <td className="px-4 py-2 pl-8 text-zinc-400">
                        {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                      </td>
                      <td className="px-4 py-2 text-zinc-300">
                        {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–
                        {e.clock_out
                          ? new Date(e.clock_out).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
                          : "open"}
                        {e.break_seconds > 0 && (
                          <span className="text-zinc-500"> · {Math.round(e.break_seconds / 60)}m break</span>
                        )}
                      </td>
                      {canSeeWages && (
                        <>
                          <td className="px-4 py-2 text-zinc-600">—</td>
                          <td className="px-4 py-2 text-zinc-400">{fmt((workedSeconds(e, now) / 3600) * emp.hourly_rate, 2)}</td>
                        </>
                      )}
                      <td className="px-4 py-2 text-zinc-600">—</td>
                      <td className="px-4 py-2">
                        {off || e.auto_clock_out ? (
                          <span className="inline-flex items-center gap-2 text-amber-300">
                            {off && (
                              <span className="inline-flex items-center gap-1">
                                <MapPinOff className="h-3 w-3" /> off-site
                              </span>
                            )}
                            {e.auto_clock_out && (
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3" /> auto
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      {isManager && (
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => setEditing({ entry: e, employeeName: emp.name })}
                            className="cursor-pointer text-zinc-500 hover:text-white"
                            title="Fix this shift"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                });
                return [summaryRow, ...detailRows];
              })}
          </Table>
        )}
      </Card>

      {editing && (
        <EditEntryModal
          orgId={org!.id}
          entry={editing.entry}
          employeeName={editing.employeeName}
          onClose={() => setEditing(null)}
          onSaved={() => invalidate("time_entries")}
        />
      )}
    </div>
  );
}
