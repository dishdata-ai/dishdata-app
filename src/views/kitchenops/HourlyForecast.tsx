"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { DAYPARTS, HOURS, expectedHour, WEEKDAYS } from "@/lib/kitchen-ops";
import { DayPicker, heat, fmt1 } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";

export default function HourlyForecast({ k, multiplier }: { k: KitchenOpsCtx; multiplier: number }) {
  const [day, setDay] = useState(k.defaultDay);
  const rows = k.dishes
    .filter((d) => d.is_active)
    .map((d) => ({ d, vals: HOURS.map((h) => expectedHour(k.model, d.id, day, h, multiplier)) }))
    .filter((r) => r.vals.some((v) => v > 0.05))
    .sort((a, b) => b.vals.reduce((x, y) => x + y, 0) - a.vals.reduce((x, y) => x + y, 0));
  const max = Math.max(0, ...rows.flatMap((r) => r.vals));
  const totals = HOURS.map((_, i) => rows.reduce((s, r) => s + r.vals[i], 0));
  const peak = totals.indexOf(Math.max(...totals));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayPicker value={day} onChange={setDay} days={WEEKDAYS} />
        <p className="text-xs text-zinc-500">
          Portions expected per hour · from {k.model.samples[day]} observed {WEEKDAYS.find((w) => w.day === day)?.label}
          {k.model.samples[day] === 1 ? "" : "s"}
          {multiplier !== 1 && ` · busy-day ×${multiplier}`}
        </p>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] tracking-wide text-zinc-500 uppercase">
              <th className="px-3 py-2 text-left" />
              {DAYPARTS.map((p) => (
                <th key={p.id} colSpan={p.to - p.from + 1} className="border-l border-line px-2 py-2 text-center">
                  {p.label}
                </th>
              ))}
              <th className="border-l border-line px-2 py-2 text-right">Day</th>
            </tr>
            <tr className="border-b border-line text-xs text-zinc-400">
              <th className="px-3 py-2 text-left font-semibold">Dish</th>
              {HOURS.map((h) => (
                <th key={h} className="px-1 py-2 text-center font-medium tabular-nums">
                  {h}:00
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.d.id} className="border-b border-line/50">
                <td className="px-3 py-1.5 font-semibold text-white">{r.d.dish}</td>
                {r.vals.map((v, i) => (
                  <td key={i} className="px-1 py-1.5 text-center tabular-nums text-zinc-200" style={heat(v, max)}>
                    {v >= 0.05 ? fmt1(v) : ""}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right font-bold tabular-nums text-brand-300">{fmt1(r.vals.reduce((a, b) => a + b, 0))}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="bg-white/[0.03] font-bold text-white">
                <td className="px-3 py-2">All dishes</td>
                {totals.map((t, i) => (
                  <td key={i} className="px-1 py-2 text-center tabular-nums">
                    {fmt1(t)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums">{fmt1(totals.reduce((a, b) => a + b, 0))}</td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">No sales history for this weekday yet.</p>}
      </Card>
      {rows.length > 0 && (
        <p className="text-sm text-zinc-300">
          Busiest hour: <b className="text-white">{HOURS[peak]}:00–{HOURS[peak] + 1}:00</b> (~{fmt1(totals[peak])} portions across all dishes). Have curries hot and porotta counted before then.
        </p>
      )}
    </div>
  );
}
