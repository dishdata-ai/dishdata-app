"use client";

import { useMemo, useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import { Card } from "@/components/ui";
import { prepBoard, SERVICE_BLOCKS, WEEKDAYS, type ServiceBlock } from "@/lib/kitchen-ops";
import { DayPicker, MethodChip, fmt1 } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";
import { cn } from "@/lib/utils";

const todayKey = () => new Date().toDateString();

function useDone() {
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("kitchenops:prep-done") ?? "{}");
      return raw.day === todayKey() ? raw.done : {};
    } catch {
      return {};
    }
  });
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("kitchenops:prep-done", JSON.stringify({ day: todayKey(), done: next }));
      } catch {
        /* private mode: ticks just won't persist */
      }
      return next;
    });
  return { done, toggle };
}

export default function TodayPrep({ k, multiplier }: { k: KitchenOpsCtx; multiplier: number }) {
  const [day, setDay] = useState(k.defaultDay);
  const { done, toggle } = useDone();
  const boards = useMemo(
    () => ({
      lunch: prepBoard(k.model, k.dishes, day, "lunch", multiplier),
      dinner: prepBoard(k.model, k.dishes, day, "dinner", multiplier),
    }),
    [k.model, k.dishes, day, multiplier],
  );
  const isToday = day === k.now.getDay();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayPicker value={day} onChange={setDay} days={WEEKDAYS} />
        <p className="text-xs text-zinc-500">
          Based on {k.model.samples[day]} service day{k.model.samples[day] === 1 ? "" : "s"} · +15% safety stock
          {multiplier !== 1 && ` · busy-day ×${multiplier}`}
          {isToday && " · counts below include what you already have"}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(Object.keys(SERVICE_BLOCKS) as ServiceBlock[]).map((block) => {
          const lines = boards[block];
          const busy = lines.filter((l) => l.opening > 0);
          const idle = lines.filter((l) => l.opening === 0);
          return (
            <Card key={block} className="p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="font-display text-xl font-bold text-white">{SERVICE_BLOCKS[block].label}</h3>
                <span className="text-xs text-zinc-500">
                  {SERVICE_BLOCKS[block].from}:00–{SERVICE_BLOCKS[block].to + 1}:00
                </span>
              </div>
              <ul className="divide-y divide-line/60">
                {busy.map((l) => {
                  const id = `${block}:${l.dish.id}`;
                  const ticked = !!done[id];
                  return (
                    <li key={l.dish.id} className="flex items-start gap-3 py-2.5">
                      <button onClick={() => toggle(id)} aria-label={ticked ? "Mark not prepared" : "Mark prepared"} className="mt-0.5 cursor-pointer text-zinc-400 hover:text-white">
                        {ticked ? <CheckSquare className="h-5 w-5 text-brand-400" /> : <Square className="h-5 w-5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-semibold", ticked ? "text-zinc-500 line-through" : "text-white")}>
                          {l.dish.dish} <span className="font-normal text-zinc-400">— {l.text}</span>
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                          <MethodChip method={l.dish.method} />
                          <span>expect ~{fmt1(l.expected)}</span>
                          {isToday && l.usable > 0 && <span>have {l.usable}</span>}
                          {l.toPrep > 0 && isToday && <span className="font-semibold text-amber-soft">make {l.toPrep} now</span>}
                        </div>
                      </div>
                      <span className="font-display text-2xl font-bold tabular-nums text-brand-300">{l.opening}</span>
                    </li>
                  );
                })}
              </ul>
              {busy.length === 0 && <p className="py-4 text-sm text-zinc-500">No sales history for this day yet.</p>}
              {idle.length > 0 && (
                <p className="mt-3 border-t border-line pt-3 text-xs text-zinc-500">
                  Not needed unless ordered: {idle.map((l) => l.dish.dish).join(", ")}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
