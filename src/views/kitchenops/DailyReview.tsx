"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui";
import { logToday, nextServiceDay, soldOnDay, speedStats, tomorrowRecommendations, wasteStats, WEEKDAYS } from "@/lib/kitchen-ops";
import { Stat, fmt1, minutes } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";
import { cn } from "@/lib/utils";

const TONE = { rose: "border-rose-soft/40 bg-rose-soft/[0.06]", amber: "border-amber-soft/40 bg-amber-soft/[0.05]", green: "border-brand-400/30 bg-brand-400/[0.05]", neutral: "border-line bg-white/[0.02]" } as const;

export default function DailyReview({ k }: { k: KitchenOpsCtx }) {
  const d = useMemo(() => {
    const sold = soldOnDay(k.orders, k.dishes, k.now);
    const cookedToday = new Map<string, number>();
    for (const e of logToday(k.log, "cooked", k.now)) cookedToday.set(e.dish, (cookedToday.get(e.dish) ?? 0) + Number(e.portions));
    const wastedToday = new Map<string, { q: number; v: number }>();
    for (const e of logToday(k.log, "wasted", k.now)) {
      const cur = wastedToday.get(e.dish) ?? { q: 0, v: 0 };
      wastedToday.set(e.dish, { q: cur.q + Number(e.portions), v: cur.v + Number(e.value) });
    }
    const rows = k.dishes.filter((x) => x.is_active).map((x) => ({
      dish: x, sold: sold.get(x.id) ?? 0, prepared: cookedToday.get(x.dish) ?? 0, remaining: x.hot_portions + x.fridge_portions,
      wasted: wastedToday.get(x.dish)?.q ?? 0, value: wastedToday.get(x.dish)?.v ?? 0,
    }));
    const w14 = wasteStats(k.log, 14, k.now.getTime());
    const sales14 = k.dishes.filter((x) => x.is_active).map((x) => ({ x, total: k.model.byDish.get(x.id)?.total ?? 0 }));
    return {
      rows,
      best: [...rows].sort((a, b) => b.sold - a.sold).filter((r) => r.sold > 0).slice(0, 5),
      slow: [...sales14].filter((s) => k.model.serviceDays >= 7).sort((a, b) => a.total - b.total).slice(0, 5),
      runsOut: w14.filter((w) => w.stockouts >= 2).sort((a, b) => b.stockouts - a.stockouts),
      overproduced: w14.filter((w) => w.pct !== null && w.pct >= 10).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)),
      speed: speedStats(k.orders, k.dishes, k.now.getTime()),
    };
  }, [k.orders, k.dishes, k.log, k.model, k.now]);

  const tomorrow = nextServiceDay(k.now);
  const recs = useMemo(() => tomorrowRecommendations(k.model, k.dishes, k.log, tomorrow, k.now.getTime()), [k.model, k.dishes, k.log, tomorrow, k.now]);
  const sum = (f: (r: (typeof d.rows)[number]) => number) => d.rows.reduce((s, r) => s + f(r), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Prepared" value={fmt1(sum((r) => r.prepared))} sub="logged as cooked" />
        <Stat label="Sold" value={fmt1(sum((r) => r.sold))} sub="portions today" tone="green" />
        <Stat label="Left over" value={fmt1(sum((r) => r.remaining))} sub="hot + fridge now" />
        <Stat label="Wasted" value={fmt1(sum((r) => r.wasted))} tone={sum((r) => r.wasted) ? "amber" : "green"} />
        <Stat label="Waste €" value={`€${sum((r) => r.value).toFixed(2)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">Today by dish</div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[10px] tracking-wide text-zinc-500 uppercase">{["Dish", "Prepared", "Sold", "Left", "Wasted", "Waste €"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {d.rows.filter((r) => r.sold || r.prepared || r.remaining || r.wasted).map((r) => (
                <tr key={r.dish.id} className="border-b border-line/50 tabular-nums">
                  <td className="px-3 py-2 font-semibold text-white">{r.dish.dish}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.prepared || "—"}</td>
                  <td className="px-3 py-2 font-bold text-brand-300">{r.sold || "—"}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.remaining || "—"}</td>
                  <td className={cn("px-3 py-2", r.wasted ? "text-amber-soft" : "text-zinc-600")}>{r.wasted || "—"}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.value ? `€${r.value.toFixed(2)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">Ticket speed today</h3>
            <p className="text-sm text-zinc-300">Average <b className="text-white">{minutes(d.speed.avgWait)}</b> · slowest <b className="text-white">{minutes(d.speed.maxWait)}</b></p>
            <p className="mt-1 text-xs text-zinc-500">{d.speed.measured} tickets timed</p>
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">Best sellers today</h3>
            {d.best.length ? <ol className="space-y-1 text-sm">{d.best.map((r, i) => <li key={r.dish.id} className="flex justify-between text-zinc-300"><span>{i + 1}. {r.dish.dish}</span><b className="text-white">{r.sold}</b></li>)}</ol> : <p className="text-sm text-zinc-500">No sales yet today.</p>}
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">Slow-moving (all history)</h3>
            {d.slow.length ? <ul className="space-y-1 text-sm text-zinc-300">{d.slow.map((s) => <li key={s.x.id} className="flex justify-between"><span>{s.x.dish}</span><span className="text-zinc-500">{s.total} sold</span></li>)}</ul> : <p className="text-sm text-zinc-500">Needs a week of sales.</p>}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Items that run out often (14 days)</h3>
          {d.runsOut.length ? <ul className="space-y-1 text-sm text-zinc-300">{d.runsOut.map((w) => <li key={w.dish}>{w.dish} — <b className="text-rose-soft">{w.stockouts}×</b></li>)}</ul> : <p className="text-sm text-zinc-500">Nothing — or stock-outs aren&apos;t being counted yet (they log when a count hits zero).</p>}
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Items often over-produced (14 days)</h3>
          {d.overproduced.length ? <ul className="space-y-1 text-sm text-zinc-300">{d.overproduced.map((w) => <li key={w.dish}>{w.dish} — <b className="text-amber-soft">{w.pct!.toFixed(0)}% wasted</b></li>)}</ul> : <p className="text-sm text-zinc-500">No item above 10% waste.</p>}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">For {WEEKDAYS.find((w) => w.day === tomorrow)?.label ?? "tomorrow"}</h3>
        <ul className="space-y-2">
          {recs.map((r, i) => <li key={i} className={cn("rounded-lg border px-3 py-2 text-sm text-zinc-200", TONE[r.tone])}>{r.text}</li>)}
        </ul>
      </Card>
    </div>
  );
}
