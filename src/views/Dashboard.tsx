"use client";

import { useMemo, useState } from "react";
import { DollarSign, Percent, ShoppingCart, Receipt, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import { MyDayView } from "@/views/MyDay";
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
import {
  Card,
  SectionTitle,
  StatCard,
  Badge,
  EmptyState,
  PageSkeleton,
  CHART_COLORS,
  chartTooltipStyle,
} from "@/components/ui";
import { useOrders, useRecipes, useInventory, useInventoryTransactions } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { computeInsights } from "@/lib/insights";
import {
  revenueByDay,
  revenueByHour,
  ordersInRange,
  sumRevenue,
  pctChange,
  recipeCost,
  unitsSold,
} from "@/lib/calc";
import { cn } from "@/lib/utils";

type Period = "daily" | "weekly" | "monthly";

export default function Dashboard() {
  const [period, setPeriod] = useState<Period>("weekly");
  const { org, role } = useOrg();
  const fmt = useFmt();
  const ordersQ = useOrders();
  const recipesQ = useRecipes();
  const inventoryQ = useInventory();
  const txQ = useInventoryTransactions();
  // Staff see their personal day first — full analytics stay for managers+
  const staffView = role === "staff";

  const orders = ordersQ.data ?? [];
  const recipes = recipesQ.data ?? [];

  const stats = useMemo(() => {
    const days = period === "daily" ? 1 : period === "weekly" ? 7 : 30;
    const current = ordersInRange(orders, days - 1);
    const previous = ordersInRange(orders, days * 2 - 1, days);
    const revenue = sumRevenue(current);
    const prevRevenue = sumRevenue(previous);
    return {
      revenue,
      revenueTrend: pctChange(revenue, prevRevenue),
      orderCount: current.length,
      ordersTrend: pctChange(current.length, previous.length),
      avgTicket: current.length ? revenue / current.length : 0,
      avgTrend: pctChange(
        current.length ? revenue / current.length : 0,
        previous.length ? prevRevenue / previous.length : 0,
      ),
    };
  }, [orders, period]);

  // Food cost % weighted by what actually sold (last 7 days)
  const foodCost = useMemo(() => {
    const sold = unitsSold(ordersInRange(orders, 6));
    let cost = 0;
    let revenue = 0;
    for (const r of recipes) {
      const units = sold.get(r.id) ?? 0;
      cost += recipeCost(r) * units;
      revenue += r.price * units;
    }
    return revenue > 0 ? (cost / revenue) * 100 : 0;
  }, [orders, recipes]);

  const series = useMemo(
    () =>
      period === "daily"
        ? revenueByHour(orders)
        : revenueByDay(orders, period === "weekly" ? 7 : 30),
    [orders, period],
  );

  const salesMix = useMemo(() => {
    const sold = unitsSold(ordersInRange(orders, 6));
    const byCat = new Map<string, number>();
    for (const r of recipes) {
      const units = sold.get(r.id) ?? 0;
      if (units > 0) byCat.set(r.category, (byCat.get(r.category) ?? 0) + units * r.price);
    }
    const total = [...byCat.values()].reduce((s, v) => s + v, 0) || 1;
    return [...byCat.entries()]
      .map(([name, v]) => ({ name, value: Math.round((v / total) * 100) }))
      .sort((a, b) => b.value - a.value);
  }, [orders, recipes]);

  const insights = useMemo(
    () =>
      computeInsights({
        recipes,
        inventory: inventoryQ.data ?? [],
        orders,
        transactions: txQ.data ?? [],
        targetFoodCostPct: org?.target_food_cost_pct ?? 28,
        fmt,
      }),
    [recipes, inventoryQ.data, orders, txQ.data, org?.target_food_cost_pct, fmt],
  );

  if (ordersQ.isLoading || recipesQ.isLoading) return <PageSkeleton />;

  if (staffView) {
    return (
      <div className="space-y-6">
        <SectionTitle title="My Day" subtitle={`Welcome back — here's your shift at ${org?.name}.`} />
        <MyDayView />
      </div>
    );
  }

  const target = org?.target_food_cost_pct ?? 28;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Dashboard"
        subtitle="Your restaurant at a glance — live numbers, costs, and computed signals."
        action={
          <div className="flex rounded-xl border border-line bg-surface p-1">
            {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all",
                  period === p
                    ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Revenue"
          value={fmt(stats.revenue)}
          hint={`vs previous ${period === "daily" ? "day" : period === "weekly" ? "week" : "month"}`}
          icon={DollarSign}
          trend={stats.revenueTrend}
        />
        <StatCard
          title="Food Cost"
          value={foodCost > 0 ? `${foodCost.toFixed(1)}%` : "—"}
          hint={`target ${target}%`}
          icon={Percent}
          trend={foodCost > 0 ? +(foodCost - target).toFixed(1) : undefined}
          trendGoodWhenDown
        />
        <StatCard title="Orders" value={String(stats.orderCount)} hint="completed" icon={ShoppingCart} trend={stats.ordersTrend} />
        <StatCard title="Avg Ticket" value={fmt(stats.avgTicket, 2)} hint="per order" icon={Receipt} trend={stats.avgTrend} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-white">Revenue</h3>
              <p className="text-xs text-zinc-500 capitalize">
                {period === "daily" ? "Today by hour" : period === "weekly" ? "Last 7 days" : "Last 30 days"}
              </p>
            </div>
            <Badge tone={stats.revenueTrend >= 0 ? "green" : "rose"}>
              {stats.revenueTrend >= 0 ? "+" : ""}
              {stats.revenueTrend}%
            </Badge>
          </div>
          {stats.revenue === 0 ? (
            <EmptyState title="No sales in this period" hint="Ring up an order in the POS — it lands here instantly." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
                <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={70} />
                <Tooltip {...chartTooltipStyle} formatter={(v) => [fmt(Number(v)), "Revenue"]} />
                <Area type="monotone" dataKey="revenue" stroke="#34d399" strokeWidth={2.5} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 font-semibold text-white">Sales Mix</h3>
          <p className="text-xs text-zinc-500">Revenue share by category · last 7 days</p>
          {salesMix.length === 0 ? (
            <EmptyState title="No category data yet" hint="Sales populate the mix automatically." />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={salesMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={86} paddingAngle={3} strokeWidth={0}>
                  {salesMix.map((_, i) => (
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
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-soft" />
            <h3 className="font-semibold text-white">Live Insights</h3>
            <Badge tone="violet">{insights.length}</Badge>
          </div>
          <Link href="/insights" className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline">
            All insights <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        {insights.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="All clear"
            hint="No issues detected — insights appear as your data shows patterns worth acting on."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {insights.slice(0, 4).map((ins) => (
              <div key={ins.id} className="flex items-start gap-3 rounded-xl border border-line bg-white/[0.02] p-3.5">
                <Badge tone={ins.priority === "high" ? "rose" : ins.priority === "medium" ? "amber" : "neutral"} className="mt-0.5 shrink-0 capitalize">
                  {ins.priority}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{ins.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{ins.detail}</p>
                </div>
                <span className="ml-auto shrink-0 text-right text-xs font-semibold text-brand-300">{ins.impact}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
