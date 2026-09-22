"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui";
import { sortByUrgency } from "@/lib/kitchen-ops";
import { Counter, MethodChip, StatusPill, fmt1 } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";
import { cn } from "@/lib/utils";

export default function StockReplenishment({ k }: { k: KitchenOpsCtx }) {
  const rows = useMemo(() => sortByUrgency(k.rows), [k.rows]);
  const th = "whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-zinc-500 uppercase";
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        When to make more of each dish. <b className="text-zinc-200">Reorder at</b> is the count that triggers a new batch; <b className="text-zinc-200">Make</b> is expected demand
        for the next 2 hours plus 15% safety, minus what you have.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Dish", "Method", "Hot / ready", "Fridge / freezer", "Left", "Min", "Reorder at", "Batch", "Next hour", "Status", "Make", "What to do"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dish.id} className={cn("border-b border-line/50", r.status === "urgent" && "bg-rose-soft/[0.05]", r.status === "not_needed" && "opacity-60")}>
                <td className="px-3 py-2 font-semibold whitespace-nowrap text-white">{r.dish.dish}</td>
                <td className="px-3 py-2"><MethodChip method={r.dish.method} /></td>
                <td className="px-3 py-2"><Counter value={r.hot} onChange={(d) => k.adjust(r.dish, "hot_portions", d)} label={`${r.dish.dish} hot`} /></td>
                <td className="px-3 py-2"><Counter value={r.fridge} onChange={(d) => k.adjust(r.dish, "fridge_portions", d)} label={`${r.dish.dish} fridge`} tone="cyan" /></td>
                <td className="px-3 py-2 text-lg font-bold tabular-nums text-white">{r.usable}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">{r.dish.min_portions}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">{r.dish.reorder_at}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">{r.dish.batch_portions}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">~{fmt1(r.nextHour)}</td>
                <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                <td className={cn("px-3 py-2 text-lg font-bold tabular-nums", r.recommend > 0 ? "text-amber-soft" : "text-zinc-600")}>{r.recommend || "–"}</td>
                <td className="px-3 py-2 text-xs text-zinc-300">{r.action}{r.note && <span className="mt-0.5 block font-semibold text-amber-soft">{r.note}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
