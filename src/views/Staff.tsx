import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Users, BadgeDollarSign, Gauge, Plus, Percent, UtensilsCrossed, UserX, RotateCcw, Pencil } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import {
  Card,
  SectionTitle,
  StatCard,
  Button,
  Modal,
  Input,
  Field,
  EmptyState,
  PageSkeleton,
  Badge,
  chartTooltipStyle,
} from "@/components/ui";
import { AvailabilityBoard } from "@/components/Availability";
import { useEmployees, useOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addEmployee, updateEmployee } from "@/lib/api/people";
import { getStaffDiscountReport, getStaffMealReport } from "@/lib/api/orders";
import { revenueByDay } from "@/lib/calc";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { Employee } from "@/lib/api/database.types";

const WEEKLY_HOURS_ESTIMATE = 38;

const REPORT_RANGES = [
  { id: "month", label: "This month" },
  { id: "90d", label: "Last 90 days" },
  { id: "all", label: "All time" },
] as const;

/** ISO lower bound for a range id — null means no bound. */
function rangeStart(id: (typeof REPORT_RANGES)[number]["id"]): string | null {
  const d = new Date();
  if (id === "month") return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  if (id === "90d") {
    d.setDate(d.getDate() - 90);
    return d.toISOString();
  }
  return null;
}

/**
 * Who is giving away staff discounts, how often, and what it costs. Aggregated
 * server-side so it covers all history rather than the orders the client
 * happens to have cached.
 */
function StaffDiscountReport() {
  const fmt = useFmt();
  const { org } = useOrg();
  const [range, setRange] = useState<(typeof REPORT_RANGES)[number]["id"]>("month");

  const reportQ = useQuery({
    queryKey: ["staffDiscountReport", org?.id, range],
    queryFn: () => getStaffDiscountReport(org!.id, rangeStart(range)),
    enabled: !!org?.id,
  });

  // Nothing configured and nothing ever given — don't take up space explaining
  // a feature that isn't switched on.
  const enabled = (org?.staff_discount_max_pct ?? 0) > 0;
  const rows = reportQ.data ?? [];
  if (!enabled && rows.length === 0) return null;

  const totals = rows.reduce(
    (a, r) => ({
      orders: a.orders + r.orders,
      given: +(a.given + r.discount_given).toFixed(2),
      revenue: +(a.revenue + r.revenue).toFixed(2),
    }),
    { orders: 0, given: 0, revenue: 0 },
  );

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <Percent className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Staff Discounts</h3>
        <div className="ml-auto flex gap-1.5">
          {REPORT_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-all",
                range === r.id
                  ? "border border-brand-400/40 bg-brand-500/15 text-brand-200"
                  : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Orders each person brought in on their own discount, and what it cost.
        {org?.staff_discount_monthly_cap != null && <> Monthly limit {fmt(org.staff_discount_monthly_cap, 2)} each.</>}
      </p>

      {reportQ.isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No staff discounts given in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-zinc-500">
                <th className="pb-2 font-medium">Employee</th>
                <th className="pb-2 text-right font-medium">Orders</th>
                <th className="pb-2 text-right font-medium">Revenue</th>
                <th className="pb-2 text-right font-medium">Given away</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => {
                const cap = org?.staff_discount_monthly_cap;
                const overHalf = range === "month" && cap != null && r.discount_given > cap * 0.8;
                return (
                  <tr key={r.employee_id}>
                    <td className="py-2">
                      <span className="font-medium text-white">{r.employee_name}</span>
                      {r.role_title && <span className="ml-2 text-xs text-zinc-500">{r.role_title}</span>}
                    </td>
                    <td className="py-2 text-right text-zinc-300">{r.orders}</td>
                    <td className="py-2 text-right text-zinc-300">{fmt(r.revenue, 2)}</td>
                    <td className={cn("py-2 text-right font-semibold", overHalf ? "text-amber-300" : "text-brand-300")}>
                      {fmt(r.discount_given, 2)}
                      {range === "month" && cap != null && (
                        <span className="ml-1 text-xs font-normal text-zinc-500">/ {fmt(cap, 0)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="pt-2 text-zinc-400">Total</td>
                <td className="pt-2 text-right text-white">{totals.orders}</td>
                <td className="pt-2 text-right text-white">{fmt(totals.revenue, 2)}</td>
                <td className="pt-2 text-right text-brand-300">{fmt(totals.given, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * Who's claiming free staff meals/drinks, how often, and what it's costing —
 * mirrors StaffDiscountReport above, but for the separate daily allowance
 * budget (0048) rather than the monthly discretionary discount.
 */
function StaffMealReport() {
  const fmt = useFmt();
  const { org } = useOrg();
  const [range, setRange] = useState<(typeof REPORT_RANGES)[number]["id"]>("month");

  const reportQ = useQuery({
    queryKey: ["staffMealReport", org?.id, range],
    queryFn: () => getStaffMealReport(org!.id, rangeStart(range)),
    enabled: !!org?.id,
  });

  const enabled = (org?.staff_meal_daily_limit ?? 0) > 0;
  const rows = reportQ.data ?? [];
  if (!enabled && rows.length === 0) return null;

  const totals = rows.reduce(
    (a, r) => ({
      orders: a.orders + r.orders,
      meal: +(a.meal + r.meal_amount).toFixed(2),
      discounted: +(a.discounted + r.discounted_amount).toFixed(2),
    }),
    { orders: 0, meal: 0, discounted: 0 },
  );

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <UtensilsCrossed className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Staff Meals &amp; Drinks</h3>
        <div className="ml-auto flex gap-1.5">
          {REPORT_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-all",
                range === r.id
                  ? "border border-brand-400/40 bg-brand-500/15 text-brand-200"
                  : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Self-served at the till against each person's daily allowance
        {org?.staff_meal_daily_limit != null && <> ({fmt(org.staff_meal_daily_limit, 2)}/day each)</>} — inventory for
        these is tracked separately from regular sales.
      </p>

      {reportQ.isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-zinc-500">No staff meals claimed in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-zinc-500">
                <th className="pb-2 font-medium">Employee</th>
                <th className="pb-2 text-right font-medium">Orders</th>
                <th className="pb-2 text-right font-medium">Free (allowance)</th>
                <th className="pb-2 text-right font-medium">Charged (extra)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rows.map((r) => (
                <tr key={r.employee_id}>
                  <td className="py-2">
                    <span className="font-medium text-white">{r.employee_name}</span>
                    {r.role_title && <span className="ml-2 text-xs text-zinc-500">{r.role_title}</span>}
                  </td>
                  <td className="py-2 text-right text-zinc-300">{r.orders}</td>
                  <td className="py-2 text-right font-semibold text-brand-300">{fmt(r.meal_amount, 2)}</td>
                  <td className="py-2 text-right text-zinc-400">
                    {r.discounted_amount > 0 ? fmt(r.discounted_amount, 2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="pt-2 text-zinc-400">Total</td>
                <td className="pt-2 text-right text-white">{totals.orders}</td>
                <td className="pt-2 text-right text-brand-300">{fmt(totals.meal, 2)}</td>
                <td className="pt-2 text-right text-zinc-300">{totals.discounted > 0 ? fmt(totals.discounted, 2) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function EditEmployeeForm({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role_title);
  const [rate, setRate] = useState(String(employee.hourly_rate));
  const [shift, setShift] = useState(employee.shift_note ?? "");
  const [pin, setPin] = useState(employee.pin ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateEmployee(org!.id, employee.id, {
        name: name.trim() || employee.name,
        role_title: role.trim() || employee.role_title,
        hourly_rate: +rate || employee.hourly_rate,
        shift_note: shift.trim() || null,
        pin: pin.trim() || null,
      });
      invalidate("employees");
      toast.success("Employee updated", name.trim());
      onDone();
    } catch (e) {
      toast.error("Could not update employee", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    setSaving(true);
    try {
      await updateEmployee(org!.id, employee.id, { is_active: false });
      invalidate("employees");
      toast.success("Employee deactivated", `${employee.name} is off the active roster`);
      onDone();
    } catch (e) {
      toast.error("Could not deactivate", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Full name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Input value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Hourly rate">
          <Input type="number" min="0" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
      <Field label="Usual shift (optional)">
        <Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="Wed–Sun · 16:00–24:00" />
      </Field>
      <Field label="PIN (optional — used at the till: staff meals, discount approval)">
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="e.g. 4821"
          inputMode="numeric"
          maxLength={8}
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="danger" disabled={saving} onClick={deactivate}>
          <UserX className="h-4 w-4" /> Deactivate
        </Button>
        <Button className="flex-1" disabled={!name.trim() || saving} onClick={save}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

function AddEmployeeForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const [shift, setShift] = useState("");
  const [pin, setPin] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addEmployee(org!.id, {
        user_id: null,
        name: name.trim(),
        role_title: role.trim() || "Server",
        hourly_rate: +rate || 15,
        pin: pin.trim() || null,
        shift_note: shift.trim() || null,
        avatar_hue: Math.floor(Math.random() * 360),
        is_active: true,
      }),
    onSuccess: () => {
      invalidate("employees");
      toast.success("Employee added", name.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not add employee", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Full name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jordan Lee" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Server" />
        </Field>
        <Field label="Hourly rate">
          <Input type="number" min="0" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18" />
        </Field>
      </div>
      <Field label="Usual shift (optional)">
        <Input value={shift} onChange={(e) => setShift(e.target.value)} placeholder="Wed–Sun · 16:00–24:00" />
      </Field>
      <Field label="PIN (optional — used at the till)">
        <Input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          placeholder="e.g. 4821"
          inputMode="numeric"
          maxLength={8}
        />
      </Field>
      <Button className="w-full" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
        Add Employee
      </Button>
    </div>
  );
}

export default function Staff() {
  const fmt = useFmt();
  const employeesQ = useEmployees();
  const ordersQ = useOrders();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const { org } = useOrg();
  const invalidate = useInvalidate();

  const employees = (employeesQ.data ?? []).filter((e) => e.is_active);
  const inactiveEmployees = (employeesQ.data ?? []).filter((e) => !e.is_active);

  const reactivate = async (e: Employee) => {
    try {
      await updateEmployee(org!.id, e.id, { is_active: true });
      invalidate("employees");
      toast.success("Employee reactivated", e.name);
    } catch (err) {
      toast.error("Could not reactivate", errorMessage(err));
    }
  };
  const weeklyLabor = employees.reduce((s, m) => s + m.hourly_rate * WEEKLY_HOURS_ESTIMATE, 0);

  const laborByDay = useMemo(() => {
    const revenue = revenueByDay(ordersQ.data ?? [], 7);
    const dailyLabor = weeklyLabor / 7;
    return revenue.map((d) => ({
      day: d.label,
      laborPct: d.revenue > 0 ? Math.min(100, +((dailyLabor / d.revenue) * 100).toFixed(1)) : 0,
    }));
  }, [ordersQ.data, weeklyLabor]);

  if (employeesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Staff"
        subtitle="Roster and labor economics. Clock-ins live in Time Clock."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add Employee
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Team Size" value={String(employees.length)} hint="active employees" icon={Users} />
        <StatCard title="Weekly Labor (est)" value={fmt(weeklyLabor)} hint={`${WEEKLY_HOURS_ESTIMATE}h/week per person`} icon={BadgeDollarSign} />
        <StatCard
          title="Avg Hourly Rate"
          value={employees.length ? fmt(employees.reduce((s, e) => s + e.hourly_rate, 0) / employees.length, 2) : "—"}
          hint="across the team"
          icon={Gauge}
        />
      </div>

      {employees.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No employees yet"
            hint="Add your team — they become assignable in Tasks and can clock in via Time Clock."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add Employee
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="grid h-fit gap-3 sm:grid-cols-2">
            {employees.map((m) => (
              <div key={m.id} onClick={() => setEditing(m)} className="cursor-pointer">
                <Card className="p-4 transition-colors hover:border-brand-400/30">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-zinc-950"
                      style={{
                        background: `linear-gradient(135deg, hsl(${m.avatar_hue} 70% 65%), hsl(${m.avatar_hue + 40} 70% 55%))`,
                      }}
                    >
                      {m.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{m.name}</p>
                      <p className="text-xs text-zinc-500">{m.role_title}</p>
                    </div>
                    <span className="ml-auto shrink-0 text-sm font-semibold text-brand-300">{fmt(m.hourly_rate, 2)}/h</span>
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  </div>
                  {m.shift_note && (
                    <p className="mt-3 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-400">{m.shift_note}</p>
                  )}
                </Card>
              </div>
            ))}
          </div>

          <Card className="h-fit p-5">
            <h3 className="font-semibold text-white">Labor Cost % by Day</h3>
            <p className="mb-3 text-xs text-zinc-500">Estimated labor vs real daily revenue · target under 30%</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={laborByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
                <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis domain={[0, 60]} stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip {...chartTooltipStyle} formatter={(v) => [`${v}%`, "Labor cost"]} />
                <ReferenceLine y={30} stroke="#fbbf24" strokeDasharray="6 4" label={{ value: "target", fill: "#fbbf24", fontSize: 11, position: "right" }} />
                <Bar dataKey="laborPct" fill="#a78bfa" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {employees.length > 0 && <AvailabilityBoard employees={employees} />}

      <StaffDiscountReport />
      <StaffMealReport />

      {inactiveEmployees.length > 0 && (
        <Card className="p-5">
          <button
            onClick={() => setShowInactive((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 text-left"
          >
            <UserX className="h-4 w-4 text-zinc-500" />
            <h3 className="font-semibold text-white">Inactive</h3>
            <Badge tone="neutral">{inactiveEmployees.length}</Badge>
            <span className="ml-auto text-xs text-zinc-500">{showInactive ? "Hide" : "Show"}</span>
          </button>
          {showInactive && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {inactiveEmployees.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.02] p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-300">{m.name}</p>
                    <p className="text-xs text-zinc-500">{m.role_title}</p>
                  </div>
                  <Button variant="ghost" className="shrink-0 px-2.5 py-1.5 text-xs" onClick={() => reactivate(m)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reactivate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add Employee">
        <AddEmployeeForm onDone={() => setAdding(false)} />
      </Modal>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Edit Employee">
          <EditEmployeeForm employee={editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}
