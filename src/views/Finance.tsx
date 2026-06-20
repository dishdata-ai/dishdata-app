import { useMemo } from "react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Wallet, TrendingUp, Landmark, Percent } from "lucide-react";
import {
  Card,
  SectionTitle,
  StatCard,
  EmptyState,
  PageSkeleton,
  CHART_COLORS,
  chartTooltipStyle,
} from "@/components/ui";
import { useOrders, useExpenses, useRecipes, useEmployees } from "@/lib/hooks/data";
import { useFmt } from "@/lib/hooks/useFmt";
import { ordersInRange, sumRevenue, unitsSold, recipeCost, pctChange } from "@/lib/calc";

const WEEKLY_HOURS_ESTIMATE = 38;

export default function Finance() {
  const fmt = useFmt();
  const ordersQ = useOrders();
  const expensesQ = useExpenses();
  const recipesQ = useRecipes();
  const employeesQ = useEmployees();

  const orders = ordersQ.data ?? [];
  const expenses = expensesQ.data ?? [];
  const recipes = recipesQ.data ?? [];
  const employees = employeesQ.data ?? [];

  const period = useMemo(() => {
    const current = ordersInRange(orders, 29);
    const revenue = sumRevenue(current);
    const prevRevenue = sumRevenue(ordersInRange(orders, 59, 30));

    // COGS from actual plates sold
    const sold = unitsSold(current);
    let cogs = 0;
    for (const r of recipes) cogs += (sold.get(r.id) ?? 0) * recipeCost(r);

    // Labor estimate from roster (until time-clock data accumulates)
    const labor = employees.reduce((s, e) => s + e.hourly_rate * WEEKLY_HOURS_ESTIMATE, 0) * (30 / 7);

    const opex = expenses
      .filter((e) => new Date(e.date).getTime() > Date.now() - 30 * 86400000 && e.category !== "Food & Beverage")
      .reduce((s, e) => s + e.amount, 0);

    const gross = revenue - cogs;
    const net = gross - labor - opex;
    return { revenue, prevRevenue, cogs, gross, labor, opex, net };
  }, [orders, recipes, employees, expenses]);

  const cashFlow = useMemo(() => {
    const weeks: { label: string; inflow: number; outflow: number }[] = [];
    for (let w = 3; w >= 0; w--) {
      const inflow = sumRevenue(ordersInRange(orders, w * 7 + 6, w * 7));
      const start = Date.now() - (w * 7 + 6) * 86400000;
      const end = Date.now() - w * 7 * 86400000;
      const outflow =
        expenses
          .filter((e) => {
            const t = new Date(e.date).getTime();
            return t >= start && t <= end;
          })
          .reduce((s, e) => s + e.amount, 0) +
        employees.reduce((s, e) => s + e.hourly_rate * WEEKLY_HOURS_ESTIMATE, 0);
      weeks.push({ label: w === 0 ? "This wk" : `${w} wk ago`, inflow: Math.round(inflow), outflow: Math.round(outflow) });
    }
    return weeks;
  }, [orders, expenses, employees]);

  const expenseMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    const labor = employees.reduce((s, e) => s + e.hourly_rate * WEEKLY_HOURS_ESTIMATE, 0) * 4.3;
    if (labor > 0) map.set("Labor (est)", labor);
    const total = [...map.values()].reduce((s, v) => s + v, 0) || 1;
    return [...map.entries()]
      .map(([name, v]) => ({ name, value: Math.round((v / total) * 100) }))
      .sort((a, b) => b.value - a.value);
  }, [expenses, employees]);

  if (ordersQ.isLoading || expensesQ.isLoading) return <PageSkeleton />;

  const pnl = [
    { line: "Revenue", amount: period.revenue, pct: 100 },
    { line: "Cost of goods sold", amount: -period.cogs, pct: period.revenue ? (period.cogs / period.revenue) * 100 : 0 },
    { line: "Gross profit", amount: period.gross, pct: period.revenue ? (period.gross / period.revenue) * 100 : 0, bold: true },
    { line: "Labor (est)", amount: -period.labor, pct: period.revenue ? (period.labor / period.revenue) * 100 : 0 },
    { line: "Operating expenses", amount: -period.opex, pct: period.revenue ? (period.opex / period.revenue) * 100 : 0 },
    { line: "Net operating profit", amount: period.net, pct: period.revenue ? (period.net / period.revenue) * 100 : 0, bold: true },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle title="Finance" subtitle="P&L, cash flow and expense structure — trailing 30 days, computed live." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Revenue (30d)" value={fmt(period.revenue)} hint="all channels" icon={TrendingUp} trend={pctChange(period.revenue, period.prevRevenue)} />
        <StatCard
          title="Net Profit (30d)"
          value={fmt(period.net)}
          hint={period.revenue ? `${((period.net / period.revenue) * 100).toFixed(1)}% of revenue` : "—"}
          icon={Landmark}
        />
        <StatCard
          title="Food Cost"
          value={period.revenue ? `${((period.cogs / period.revenue) * 100).toFixed(1)}%` : "—"}
          hint="of revenue (COGS)"
          icon={Percent}
        />
        <StatCard title="Monthly Outflow" value={fmt(period.labor + period.opex + period.cogs)} hint="COGS + labor + opex" icon={Wallet} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-1 font-semibold text-white">Cash Flow</h3>
          <p className="mb-4 text-xs text-zinc-500">Weekly inflows vs outflows (labor estimated from roster)</p>
          {period.revenue === 0 ? (
            <EmptyState title="No cash flow yet" hint="Sales and expenses populate this automatically." />
          ) : (
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={cashFlow}>
                <defs>
                  <linearGradient id="cfIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cfOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fb7185" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={12} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={72} />
                <Tooltip {...chartTooltipStyle} formatter={(v, name) => [fmt(Number(v)), name === "inflow" ? "Inflow" : "Outflow"]} />
                <Legend formatter={(v) => <span style={{ color: "#a1a1aa", fontSize: 12 }}>{v === "inflow" ? "Inflow" : "Outflow"}</span>} />
                <Area type="monotone" dataKey="inflow" stroke="#34d399" strokeWidth={2.5} fill="url(#cfIn)" />
                <Area type="monotone" dataKey="outflow" stroke="#fb7185" strokeWidth={2} fill="url(#cfOut)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 font-semibold text-white">Expense Mix</h3>
          <p className="mb-4 text-xs text-zinc-500">Share of recorded spend + estimated labor</p>
          {expenseMix.length === 0 ? (
            <EmptyState title="No expenses recorded" hint="Add expenses in Accounting to see the breakdown." />
          ) : (
            <ResponsiveContainer width="100%" height={270}>
              <PieChart>
                <Pie data={expenseMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={3} strokeWidth={0}>
                  {expenseMix.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...chartTooltipStyle} formatter={(v) => [`${v}%`, "Share"]} />
                <Legend formatter={(v) => <span style={{ color: "#a1a1aa", fontSize: 12 }}>{v}</span>} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-white">Profit & Loss — trailing 30 days</h3>
        <div className="space-y-1">
          {pnl.map((row) => (
            <div
              key={row.line}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                row.bold ? "bg-white/[0.04] font-semibold text-white" : "text-zinc-300"
              }`}
            >
              <span>{row.line}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">{row.pct.toFixed(1)}%</span>
                <span className={row.amount < 0 ? "text-rose-soft" : row.bold ? "text-brand-300" : ""}>
                  {row.amount < 0 ? `(${fmt(-row.amount)})` : fmt(row.amount)}
                </span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Labor is estimated from the roster ({WEEKLY_HOURS_ESTIMATE}h/week per person) until time-clock data accumulates.
        </p>
      </Card>
    </div>
  );
}
