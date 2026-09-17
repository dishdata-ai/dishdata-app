import { useEffect, useMemo, useState } from "react";
import { Timer, Coffee, LogOut as ClockOutIcon, BadgeDollarSign, Users, MapPin, MapPinOff, Pencil } from "lucide-react";
import { Card, SectionTitle, StatCard, Badge, Button, Input, Field, Modal, EmptyState, PageSkeleton, Table } from "@/components/ui";
import { useEmployees, useTimeEntries, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { clockIn, clockOut, toggleBreak, workedSeconds, editTimeEntry } from "@/lib/api/timeclock";
import { geofenceOf } from "@/lib/geo";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { TimeEntry } from "@/lib/api/database.types";

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

  const weekStats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const map = new Map<string, { seconds: number; cost: number; offSite: number; autoOut: number }>();
    for (const e of entries) {
      if (new Date(e.clock_in).getTime() < weekAgo) continue;
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
  }, [entries, employees, now, geofence]);

  const totalWeekCost = [...weekStats.values()].reduce((s, v) => s + v.cost, 0);
  const totalWeekHours = [...weekStats.values()].reduce((s, v) => s + v.seconds, 0) / 3600;

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
          <StatCard title="Labor Cost (7d)" value={fmt(totalWeekCost)} hint="from tracked hours" icon={BadgeDollarSign} />
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
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">This Week's Timesheet</h3>
          <p className="text-xs text-zinc-500">{canSeeWages ? "Tracked hours and labor cost per person" : "Tracked hours per person"}</p>
        </div>
        {weekStats.size === 0 ? (
          <EmptyState icon={Timer} title="No hours tracked yet" hint="Clock someone in to start the timesheet." />
        ) : (
          <Table
            headers={[
              "Employee", "Hours",
              ...(canSeeWages ? ["Rate", "Labor Cost"] : []),
              "Shifts", "Flags",
              ...(isManager ? [""] : []),
            ]}
          >
            {employees
              .filter((e) => weekStats.has(e.id))
              .map((emp) => {
                const stat = weekStats.get(emp.id)!;
                const weekEntries = entries.filter(
                  (e) => e.employee_id === emp.id && new Date(e.clock_in).getTime() > Date.now() - 7 * 86400000,
                );
                const shifts = weekEntries.length;
                // Most recent first — the one someone's most likely to need
                // corrected right after noticing something's off.
                const latestEntry = [...weekEntries].sort((a, b) => b.clock_in.localeCompare(a.clock_in))[0];
                return (
                  <tr key={emp.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{emp.name}</td>
                    <td className="px-4 py-3 text-zinc-300">{(stat.seconds / 3600).toFixed(1)}h</td>
                    {canSeeWages && (
                      <>
                        <td className="px-4 py-3 text-zinc-400">{fmt(emp.hourly_rate, 2)}/h</td>
                        <td className="px-4 py-3 font-medium text-zinc-200">{fmt(stat.cost, 2)}</td>
                      </>
                    )}
                    <td className="px-4 py-3 text-zinc-400">{shifts}</td>
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
                        {latestEntry && (
                          <button
                            onClick={() => setEditing({ entry: latestEntry, employeeName: emp.name })}
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
