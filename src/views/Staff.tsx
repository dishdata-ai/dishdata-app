import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Users, BadgeDollarSign, Gauge, Plus } from "lucide-react";
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
  chartTooltipStyle,
} from "@/components/ui";
import { useEmployees, useOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addEmployee } from "@/lib/api/people";
import { revenueByDay } from "@/lib/calc";
import { toast } from "@/lib/toast";

const WEEKLY_HOURS_ESTIMATE = 38;

function AddEmployeeForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [rate, setRate] = useState("");
  const [shift, setShift] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addEmployee(org!.id, {
        user_id: null,
        name: name.trim(),
        role_title: role.trim() || "Server",
        hourly_rate: +rate || 15,
        pin: null,
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

  const employees = (employeesQ.data ?? []).filter((e) => e.is_active);
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
              <Card key={m.id} className="p-4">
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
                </div>
                {m.shift_note && (
                  <p className="mt-3 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs text-zinc-400">{m.shift_note}</p>
                )}
              </Card>
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

      <Modal open={adding} onClose={() => setAdding(false)} title="Add Employee">
        <AddEmployeeForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
