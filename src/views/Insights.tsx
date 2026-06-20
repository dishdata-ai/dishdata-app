import { useMemo, useState } from "react";
import { Sparkles, TrendingUp, Target, Banknote } from "lucide-react";
import {
  LineChart,
  Line,
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
  chartTooltipStyle,
} from "@/components/ui";
import {
  useOrders,
  useRecipes,
  useInventory,
  useInventoryTransactions,
  useSupplierPrices,
} from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { computeInsights } from "@/lib/insights";
import { forecastSeries } from "@/lib/calc";
import { cn } from "@/lib/utils";

const priorities = ["All", "high", "medium", "low"] as const;

export default function Insights() {
  const [filter, setFilter] = useState<(typeof priorities)[number]>("All");
  const { org } = useOrg();
  const fmt = useFmt();
  const ordersQ = useOrders();
  const recipesQ = useRecipes();
  const inventoryQ = useInventory();
  const txQ = useInventoryTransactions();
  const pricesQ = useSupplierPrices();

  const orders = ordersQ.data ?? [];

  const insights = useMemo(
    () =>
      computeInsights({
        recipes: recipesQ.data ?? [],
        inventory: inventoryQ.data ?? [],
        orders,
        transactions: txQ.data ?? [],
        targetFoodCostPct: org?.target_food_cost_pct ?? 28,
        fmt,
        supplierPrices: pricesQ.data ?? [],
      }),
    [recipesQ.data, inventoryQ.data, orders, txQ.data, org?.target_food_cost_pct, fmt, pricesQ.data],
  );

  const forecast = useMemo(() => forecastSeries(orders), [orders]);

  // Forecast accuracy: MAPE over history where actuals exist
  const accuracy = useMemo(() => {
    const points = forecast.filter((p) => p.actual !== null && p.actual > 0);
    if (points.length < 3) return null;
    const mape =
      points.reduce((s, p) => s + Math.abs((p.actual! - p.forecast) / p.actual!), 0) / points.length;
    return Math.max(0, Math.min(100, 100 - mape * 100));
  }, [forecast]);

  const filtered = insights.filter((i) => filter === "All" || i.priority === filter);
  const totalUpside = insights.reduce((s, i) => {
    const m = i.impact.match(/[\d,]+/);
    return s + (m ? +m[0].replace(/,/g, "") : 0);
  }, 0);

  if (ordersQ.isLoading || recipesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="AI Insights"
        subtitle="Recommendations computed live from your sales, stock and margins — not canned text."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Open Recommendations"
          value={String(insights.length)}
          hint={`${insights.filter((i) => i.priority === "high").length} high priority`}
          icon={Sparkles}
        />
        <StatCard title="Est. Value Identified" value={fmt(totalUpside)} hint="across all signals" icon={Banknote} />
        <StatCard
          title="Forecast Accuracy"
          value={accuracy !== null ? `${accuracy.toFixed(1)}%` : "—"}
          hint={accuracy !== null ? "trailing 14 days" : "needs more history"}
          icon={Target}
        />
      </div>

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent-400" />
          <h3 className="font-semibold text-white">Revenue Forecast</h3>
        </div>
        <p className="mb-4 text-xs text-zinc-500">Weekday-seasonal model · next 5 days projected</p>
        {orders.length < 5 ? (
          <EmptyState
            icon={TrendingUp}
            title="Not enough history to forecast"
            hint="The model needs a few days of sales. Keep ringing up orders."
          />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={forecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
              <XAxis dataKey="day" stroke="#71717a" fontSize={11} tickLine={false} interval="preserveStartEnd" />
              <YAxis stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={72} />
              <Tooltip
                {...chartTooltipStyle}
                formatter={(v, name) => [fmt(Number(v)), name === "actual" ? "Actual" : "Forecast"]}
              />
              <Legend formatter={(v) => <span style={{ color: "#a1a1aa", fontSize: 12 }}>{v === "actual" ? "Actual" : "Model"}</span>} />
              <Line type="monotone" dataKey="actual" stroke="#34d399" strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />
              <Line type="monotone" dataKey="forecast" stroke="#a78bfa" strokeWidth={2} strokeDasharray="6 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-white">Recommendations</h3>
          <div className="flex gap-1.5">
            {priorities.map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold capitalize transition-all",
                  filter === p
                    ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                    : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={Sparkles}
              title={insights.length === 0 ? "All clear — nothing needs attention" : "No insights at this priority"}
              hint={
                insights.length === 0
                  ? "Signals appear when stock runs low, margins slip, waste spikes, or sales patterns shift."
                  : "Try another priority filter."
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {filtered.map((ins) => (
              <Card key={ins.id} className="animate-rise p-5">
                <div className="flex items-center justify-between">
                  <Badge tone={ins.priority === "high" ? "rose" : ins.priority === "medium" ? "amber" : "neutral"} className="capitalize">
                    {ins.priority} priority
                  </Badge>
                  <Badge tone="violet">{ins.module}</Badge>
                </div>
                <h4 className="mt-3 font-semibold text-white">{ins.title}</h4>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{ins.detail}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-xs text-zinc-500">Estimated impact</span>
                  <span className="font-display text-sm font-bold text-brand-300">{ins.impact}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
