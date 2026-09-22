"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui";
import { speedHistory, speedStats } from "@/lib/kitchen-ops";
import { CHEF_STATIONS } from "@/data/kitchen-standards";
import { Stat, minutes, stationLabel } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";

export default function ServiceSpeed({ k }: { k: KitchenOpsCtx }) {
  const s = useMemo(() => speedStats(k.orders, k.dishes, k.now.getTime()), [k.orders, k.dishes, k.now]);
  const hist = useMemo(() => speedHistory(k.orders, 7, k.now.getTime()), [k.orders, k.now]);
  const loads = Object.entries(s.stationLoad).sort((a, b) => b[1] - a[1]);
  const maxLoad = Math.max(1, ...loads.map(([, q]) => q));
  const dishTarget = (name: string) => k.dishes.find((d) => d.dish === name)?.target_wait_min;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders waiting" value={String(s.waiting)} sub={s.waiting ? `oldest ${Math.round(s.oldest)} min` : "line is clear"} />
        <Stat label="Over 10 min" value={String(s.over10)} tone={s.over10 ? "amber" : "green"} />
        <Stat label="Over 15 min" value={String(s.over15)} tone={s.over15 ? "rose" : "green"} />
        <Stat label="Avg wait today" value={minutes(s.avgWait)} sub={s.measured ? `${s.measured} tickets timed · slowest ${minutes(s.maxWait)}` : "no timed tickets yet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Bottlenecks right now</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-zinc-500">Most delayed dish</dt><dd className="font-semibold text-white">{s.mostDelayed ? `${s.mostDelayed.dish} · ${Math.round(s.mostDelayed.minutes)} min` : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Most-used station</dt><dd className="font-semibold text-white">{s.busiestStation ? `${stationLabel(s.busiestStation.station)} (${s.busiestStation.qty})` : "—"}</dd></div>
            <div><dt className="text-xs text-zinc-500">Pans needed now</dt><dd className="font-display text-2xl font-bold text-white">{s.pansNow}</dd></div>
            <div><dt className="text-xs text-zinc-500">Fryer load (portions)</dt><dd className="font-display text-2xl font-bold text-white">{s.fryerLoad}</dd></div>
            <div><dt className="text-xs text-zinc-500">Stove load (portions)</dt><dd className="font-display text-2xl font-bold text-white">{s.stoveLoad}</dd></div>
            <div><dt className="text-xs text-zinc-500">Start lag (order → started)</dt><dd className="font-semibold text-white">{minutes(s.avgStartLag)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Chef workload (est.)</dt><dd className="font-semibold text-white">{Math.round(s.chefMinutes)} min</dd></div>
            <div><dt className="text-xs text-zinc-500">Helper workload (est.)</dt><dd className="font-semibold text-white">{Math.round(s.helperMinutes)} min</dd></div>
          </dl>
          <p className="mt-3 text-[11px] text-zinc-600">
            Workload = open portions × each dish&apos;s finishing time. Chef stations: {CHEF_STATIONS.map(stationLabel).join(", ")}; the rest counts as helper work.
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Open portions by station</h3>
          {loads.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing waiting.</p>
          ) : (
            <ul className="space-y-2">
              {loads.map(([st, q]) => (
                <li key={st}>
                  <div className="mb-1 flex justify-between text-xs"><span className="text-zinc-300">{stationLabel(st)}</span><span className="font-bold text-white">{q}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-brand-400" style={{ width: `${(q / maxLoad) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {s.mostDelayed && dishTarget(s.mostDelayed.dish) !== undefined && s.mostDelayed.minutes > (dishTarget(s.mostDelayed.dish) ?? 0) && (
            <p className="mt-3 text-xs font-semibold text-rose-soft">
              {s.mostDelayed.dish} is past its {dishTarget(s.mostDelayed.dish)} min target — start it first.
            </p>
          )}
        </Card>
      </div>

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">Order-to-ready time, last 7 days</div>
        {hist.length === 0 ? (
          <p className="p-5 text-sm text-zinc-500">
            No timed tickets yet. From now on every ticket marked Ready on the Kitchen board is timed (order → started → ready), so this fills in by itself.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-[10px] tracking-wide text-zinc-500 uppercase">{["Day", "Tickets", "Average", "Slowest", "Over 10 min", "Over 15 min"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {hist.map((d) => (
                <tr key={d.date.toISOString()} className="border-b border-line/50 tabular-nums">
                  <td className="px-4 py-2 text-white">{d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className="px-4 py-2 text-zinc-300">{d.tickets}</td>
                  <td className="px-4 py-2 font-bold text-white">{d.avg.toFixed(1)} min</td>
                  <td className="px-4 py-2 text-zinc-300">{d.max.toFixed(0)} min</td>
                  <td className="px-4 py-2 text-amber-soft">{d.over10}</td>
                  <td className="px-4 py-2 text-rose-soft">{d.over15}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
