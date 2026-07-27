import { useMemo, useState } from "react";
import { DollarSign, ShoppingCart, Receipt, Star, TrendingUp } from "lucide-react";
import {
  ComposedChart,
  Area,
  Bar,
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
  Table,
  EmptyState,
  PageSkeleton,
  chartTooltipStyle,
} from "@/components/ui";
import { useOrders, useRecipes } from "@/lib/hooks/data";
import { ReceiptButton } from "@/components/ReceiptButton";
import { useFmt } from "@/lib/hooks/useFmt";
import {
  revenueByDay,
  revenueByHour,
  ordersInRange,
  sumRevenue,
  pctChange,
  unitsSold,
  recipeCost,
} from "@/lib/calc";
import { cn, fmtPct } from "@/lib/utils";

type Period = "today" | "7d" | "30d";

export default function Sales() {
  const [period, setPeriod] = useState<Period>("7d");
  const [showAllSellers, setShowAllSellers] = useState(false);
  const fmt = useFmt();
  const ordersQ = useOrders();
  const recipesQ = useRecipes();
  const orders = ordersQ.data ?? [];
  const recipes = recipesQ.data ?? [];

  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  const current = useMemo(() => ordersInRange(orders, days - 1), [orders, days]);
  const previous = useMemo(() => ordersInRange(orders, days * 2 - 1, days), [orders, days]);
  const series = useMemo(
    () => (period === "today" ? revenueByHour(orders) : revenueByDay(orders, days)),
    [orders, period, days],
  );

  const revenue = sumRevenue(current);
  const prevRevenue = sumRevenue(previous);

  const allSellers = useMemo(() => {
    const sold = unitsSold(current);
    return recipes
      .map((r) => {
        const units = sold.get(r.id) ?? 0;
        return {
          id: r.id,
          name: r.name,
          emoji: r.emoji,
          sold: units,
          revenue: units * r.price,
          margin: r.price > 0 ? ((r.price - recipeCost(r)) / r.price) * 100 : 0,
        };
      })
      .sort((a, b) => b.sold - a.sold);
  }, [current, recipes]);

  const topSellers = useMemo(() => allSellers.filter((t) => t.sold > 0).slice(0, 8), [allSellers]);
  const sellersShown = showAllSellers ? allSellers : topSellers;

  if (ordersQ.isLoading || recipesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Sales"
        subtitle="Live revenue performance straight from the POS."
        action={
          <div className="flex rounded-xl border border-line bg-surface p-1">
            {(
              [
                ["today", "Today"],
                ["7d", "7 days"],
                ["30d", "30 days"],
              ] as [Period, string][]
            ).map(([p, label]) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium transition-all",
                  period === p
                    ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                    : "text-zinc-400 hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Revenue" value={fmt(revenue)} hint="this period" icon={DollarSign} trend={pctChange(revenue, prevRevenue)} />
        <StatCard title="Orders" value={String(current.length)} hint="completed" icon={ShoppingCart} trend={pctChange(current.length, previous.length)} />
        <StatCard title="Avg Ticket" value={current.length ? fmt(revenue / current.length, 2) : "—"} hint="per order" icon={Receipt} />
        <StatCard
          title="Best Seller"
          value={topSellers[0]?.name ?? "—"}
          hint={topSellers[0] ? `${topSellers[0].sold} sold` : "no sales yet"}
          icon={Star}
        />
      </div>

      <Card className="p-5">
        <h3 className="mb-1 font-semibold text-white">Revenue & Order Volume</h3>
        <p className="mb-4 text-xs text-zinc-500">{period === "today" ? "Today by hour" : `Last ${days} days`}</p>
        {revenue === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No sales in this period"
            hint="Orders rung up in the POS appear here in real time."
          />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={series}>
              <defs>
                <linearGradient id="salesRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
              <XAxis dataKey="label" stroke="#71717a" fontSize={11} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="rev" stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => fmt(v)} width={72} />
              <YAxis yAxisId="ord" orientation="right" stroke="#71717a" fontSize={12} tickLine={false} allowDecimals={false} />
              <Tooltip
                {...chartTooltipStyle}
                formatter={(v, name) => (name === "revenue" ? [fmt(Number(v)), "Revenue"] : [String(v), "Orders"])}
              />
              <Legend formatter={(v) => <span style={{ color: "#a1a1aa", fontSize: 12 }}>{v === "revenue" ? "Revenue" : "Orders"}</span>} />
              <Area yAxisId="rev" type="monotone" dataKey="revenue" stroke="#22d3ee" strokeWidth={2.5} fill="url(#salesRev)" />
              <Bar yAxisId="ord" dataKey="orders" fill="#a78bfa" radius={[4, 4, 0, 0]} barSize={16} opacity={0.85} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-line p-4">
            <div>
              <h3 className="font-semibold text-white">Top Sellers</h3>
              <p className="text-xs text-zinc-500">
                {showAllSellers ? "Every menu item, ranked by units sold" : "By units sold this period"}
              </p>
            </div>
            {allSellers.length > 0 && (
              <button
                onClick={() => setShowAllSellers((v) => !v)}
                className="cursor-pointer text-xs font-medium text-brand-300 hover:text-brand-200"
              >
                {showAllSellers ? "Show top 8" : "View all"}
              </button>
            )}
          </div>
          {sellersShown.length === 0 ? (
            <EmptyState title="No sales data" hint="Top sellers rank automatically as orders come in." />
          ) : (
            <div className={cn(showAllSellers && "max-h-96 overflow-y-auto")}>
              <Table headers={["#", "Item", "Sold", "Revenue", "Margin"]}>
                {sellersShown.map((t, idx) => (
                  <tr key={t.id} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-3 font-display font-bold text-zinc-500">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-white">
                      <span className="mr-2">{t.emoji}</span>
                      {t.name}
                    </td>
                    <td className={cn("px-4 py-3", t.sold > 0 ? "text-zinc-300" : "text-zinc-600")}>{t.sold}</td>
                    <td className="px-4 py-3 font-medium text-zinc-200">{fmt(t.revenue)}</td>
                    <td className="px-4 py-3">
                      {t.sold > 0 ? (
                        <Badge tone={t.margin >= 70 ? "green" : "amber"}>{fmtPct(t.margin, 0)}</Badge>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>

        <Card>
          <div className="border-b border-line p-4">
            <h3 className="font-semibold text-white">Recent Orders</h3>
            <p className="text-xs text-zinc-500">Latest first</p>
          </div>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" hint="Ring something up in the POS module." />
          ) : (
            <div className="max-h-96 divide-y divide-line/60 overflow-y-auto">
              {orders.slice(0, 25).map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {o.order_number}
                      <span className="ml-2 text-xs text-zinc-500 capitalize">{o.order_type.replace("_", "-")}</span>
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {o.items.map((l) => `${l.qty}× ${l.name}`).join(", ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-brand-300">{fmt(o.total, 2)}</p>
                      <Badge tone={o.status === "paid" ? "green" : "amber"} className="mt-0.5 capitalize">
                        {o.status}
                      </Badge>
                    </div>
                    {o.status === "paid" && <ReceiptButton order={o} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
