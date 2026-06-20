import { useEffect, useMemo, useState } from "react";
import { Timer, Coffee, LogOut as ClockOutIcon, BadgeDollarSign, Users } from "lucide-react";
import { Card, SectionTitle, StatCard, Badge, Button, EmptyState, PageSkeleton, Table } from "@/components/ui";
import { useEmployees, useTimeEntries, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { clockIn, clockOut, toggleBreak, workedSeconds } from "@/lib/api/timeclock";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export default function TimeClock() {
  const { org } = useOrg();
  const fmt = useFmt();
  const employeesQ = useEmployees();
  const entriesQ = useTimeEntries();
  const invalidate = useInvalidate();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const employees = (employeesQ.data ?? []).filter((e) => e.is_active);
  const entries = entriesQ.data ?? [];
  const openEntries = entries.filter((e) => !e.clock_out);
  const openByEmployee = new Map(openEntries.map((e) => [e.employee_id, e]));

  const weekStats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const map = new Map<string, { seconds: number; cost: number }>();
    for (const e of entries) {
      if (new Date(e.clock_in).getTime() < weekAgo) continue;
      const emp = employees.find((x) => x.id === e.employee_id);
      if (!emp) continue;
      const secs = workedSeconds(e, now);
      const prev = map.get(emp.id) ?? { seconds: 0, cost: 0 };
      prev.seconds += secs;
      prev.cost += (secs / 3600) * emp.hourly_rate;
      map.set(emp.id, prev);
    }
    return map;
  }, [entries, employees, now]);

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

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="On the Clock" value={String(openEntries.length)} hint="right now" icon={Timer} />
        <StatCard title="Hours This Week" value={totalWeekHours.toFixed(1)} hint="tracked across the team" icon={Users} />
        <StatCard title="Labor Cost (7d)" value={fmt(totalWeekCost)} hint="from tracked hours" icon={BadgeDollarSign} />
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
          <p className="text-xs text-zinc-500">Tracked hours and labor cost per person</p>
        </div>
        {weekStats.size === 0 ? (
          <EmptyState icon={Timer} title="No hours tracked yet" hint="Clock someone in to start the timesheet." />
        ) : (
          <Table headers={["Employee", "Hours", "Rate", "Labor Cost", "Shifts"]}>
            {employees
              .filter((e) => weekStats.has(e.id))
              .map((emp) => {
                const stat = weekStats.get(emp.id)!;
                const shifts = entries.filter(
                  (e) => e.employee_id === emp.id && new Date(e.clock_in).getTime() > Date.now() - 7 * 86400000,
                ).length;
                return (
                  <tr key={emp.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-medium text-white">{emp.name}</td>
                    <td className="px-4 py-3 text-zinc-300">{(stat.seconds / 3600).toFixed(1)}h</td>
                    <td className="px-4 py-3 text-zinc-400">{fmt(emp.hourly_rate, 2)}/h</td>
                    <td className="px-4 py-3 font-medium text-zinc-200">{fmt(stat.cost, 2)}</td>
                    <td className="px-4 py-3 text-zinc-400">{shifts}</td>
                  </tr>
                );
              })}
          </Table>
        )}
      </Card>
    </div>
  );
}
