"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui";
import { WEEKDAYS, expectedDay, nextServiceDay, weekendLift, SAFETY } from "@/lib/kitchen-ops";
import { Stat, heat, fmt1, MethodChip } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";

export default function WeeklyAnalysis({ k, multiplier }: { k: KitchenOpsCtx; multiplier: number }) {
  const tomorrow = nextServiceDay(k.now);
  const tLabel = WEEKDAYS.find((w) => w.day === tomorrow)?.label ?? "";
  const rows = useMemo(
    () =>
      k.dishes
        .filter((d) => d.is_active)
        .map((d) => {
          const dd = k.model.byDish.get(d.id);
          const perDay = WEEKDAYS.map((w) => dd?.perWeekday[w.day] ?? null);
          return { d, perDay, overall: dd?.overall ?? 0, trend: dd?.trend ?? null, tomorrow: Math.ceil(expectedDay(k.model, d.id, tomorrow, multiplier) * (1 + SAFETY)) };
        })
        .filter((r) => r.overall > 0 || r.tomorrow > 0)
        .sort((a, b) => b.overall - a.overall),
    [k.dishes, k.model, tomorrow, multiplier],
  );
  const max = Math.max(0, ...rows.flatMap((r) => r.perDay.map((v) => v ?? 0)));
  const lift = weekendLift(k.model);
  const dayTotals = WEEKDAYS.map((w) => rows.reduce((s, r) => s + (r.perDay[WEEKDAYS.findIndex((x) => x.day === w.day)] ?? 0), 0));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Service days learned" value={String(k.model.serviceDays)} sub="Monday is closed" />
        <Stat label="Fri–Sun vs Tue–Thu" value={lift === null ? "—" : `${lift >= 1 ? "+" : ""}${Math.round((lift - 1) * 100)}%`} sub="all dishes combined" tone={lift && lift > 1.2 ? "amber" : undefined} />
        <Stat label={`Prep for ${tLabel}`} value={String(rows.reduce((s, r) => s + r.tomorrow, 0))} sub="portions incl. 15% safety" />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] tracking-wide text-zinc-500 uppercase">
              <th className="px-3 py-2 text-left">Dish · avg portions per day</th>
              {WEEKDAYS.map((w) => <th key={w.day} className={`px-2 py-2 text-center ${w.day === tomorrow ? "text-brand-300" : ""}`}>{w.short}<span className="block font-normal normal-case">{k.model.samples[w.day]} days</span></th>)}
              <th className="px-2 py-2 text-center">Trend</th>
              <th className="px-3 py-2 text-right text-brand-300">Tomorrow ({tLabel.slice(0, 3)})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.d.id} className="border-b border-line/50">
                <td className="px-3 py-1.5"><span className="font-semibold text-white">{r.d.dish}</span> <MethodChip method={r.d.method} /></td>
                {r.perDay.map((v, i) => <td key={i} className="px-2 py-1.5 text-center tabular-nums text-zinc-200" style={heat(v ?? 0, max)}>{v === null ? "·" : v >= 0.05 ? fmt1(v) : "0"}</td>)}
                <td className={`px-2 py-1.5 text-center text-xs tabular-nums ${r.trend === null ? "text-zinc-600" : r.trend > 0.15 ? "text-brand-300" : r.trend < -0.15 ? "text-rose-soft" : "text-zinc-400"}`}>{r.trend === null ? "—" : `${r.trend > 0 ? "+" : ""}${Math.round(r.trend * 100)}%`}</td>
                <td className="px-3 py-1.5 text-right font-display text-lg font-bold tabular-nums text-brand-300">{r.tomorrow || "–"}</td>
              </tr>
            ))}
            <tr className="bg-white/[0.03] font-bold text-white">
              <td className="px-3 py-2">All dishes</td>
              {dayTotals.map((t, i) => <td key={i} className="px-2 py-2 text-center tabular-nums">{fmt1(t)}</td>)}
              <td /><td />
            </tr>
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">No sales history yet.</p>}
      </Card>
      <p className="text-xs text-zinc-500">Recent 14 days count double. A “·” means that weekday hasn&apos;t been observed yet. Trend compares the last 6 service days with the 6 before.</p>
    </div>
  );
}
