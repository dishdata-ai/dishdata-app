"use client";

import { useMemo } from "react";
import { ChefHat, Flame, Timer, AlertTriangle } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { sortByUrgency, speedStats, STATUS_META, type LiveRow } from "@/lib/kitchen-ops";
import { Counter, MethodChip, StatusPill, Stat, fmt1, stationLabel } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";
import { cn } from "@/lib/utils";

const border: Record<LiveRow["status"], string> = {
  urgent: "border-rose-soft/60 bg-rose-soft/[0.06]",
  soon: "border-amber-soft/50 bg-amber-soft/[0.04]",
  enough: "border-line bg-white/[0.02]",
  not_needed: "border-line/60 bg-white/[0.01] opacity-70",
};

export default function LiveKitchen({ k }: { k: KitchenOpsCtx }) {
  const sorted = useMemo(() => sortByUrgency(k.rows), [k.rows]);
  const speed = useMemo(() => speedStats(k.orders, k.dishes, k.now.getTime()), [k.orders, k.dishes, k.now]);
  const urgent = sorted.filter((r) => r.status === "urgent");
  const soon = sorted.filter((r) => r.status === "soon");
  const active = sorted.filter((r) => r.status !== "not_needed");
  const idle = sorted.filter((r) => r.status === "not_needed");
  const next = [...urgent, ...soon].slice(0, 4);

  return (
    <div className="space-y-5">
      {/* The 5-second answer */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Running out" value={String(urgent.length)} sub={urgent.length ? urgent.slice(0, 3).map((r) => r.dish.dish).join(", ") : "nothing urgent"} tone={urgent.length ? "rose" : "green"} />
        <Stat label="Prepare soon" value={String(soon.length)} sub={soon.length ? soon.slice(0, 3).map((r) => r.dish.dish).join(", ") : "all good"} tone={soon.length ? "amber" : "green"} />
        <Stat label="Orders waiting" value={String(speed.waiting)} sub={speed.waiting ? `oldest ${Math.round(speed.oldest)} min` : "line is clear"} />
        <Stat label="Over 10 min" value={String(speed.over10)} sub={speed.over15 ? `${speed.over15} over 15 min` : "none over 15"} tone={speed.over15 ? "rose" : speed.over10 ? "amber" : "green"} />
      </div>

      {next.length > 0 && (
        <Card className="border-brand-400/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <ChefHat className="h-4 w-4 text-brand-300" /> Prepare next
          </div>
          <ol className="space-y-1.5">
            {next.map((r, i) => (
              <li key={r.dish.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="font-display text-lg font-bold text-brand-300">{i + 1}</span>
                <span className="font-semibold text-white">{r.dish.dish}</span>
                <span className="text-zinc-300">{r.action}</span>
                {r.waiting > 0 && <span className="text-xs font-semibold text-rose-soft">{r.waiting} on open tickets</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {k.dishes.length === 0 && (
        <Card className="p-6 text-center text-sm text-zinc-400">No kitchen dishes set up yet — add them on the Menu &amp; methods tab.</Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {active.map((r) => (
          <div key={r.dish.id} className={cn("rounded-2xl border p-4", border[r.status])}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold text-white">{r.dish.dish}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <MethodChip method={r.dish.method} />
                  <span className="text-[11px] text-zinc-500">{stationLabel(r.dish.station)}</span>
                </div>
              </div>
              <StatusPill status={r.status} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{r.dish.bain_marie === "yes" ? "In bain-marie" : "Hot / ready"}</p>
                <Counter value={r.hot} onChange={(d) => k.adjust(r.dish, "hot_portions", d)} label={`${r.dish.dish} hot`} />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{r.dish.frozen ? "Freezer stock" : "Fridge / prepped"}</p>
                <Counter value={r.fridge} onChange={(d) => k.adjust(r.dish, "fridge_portions", d)} label={`${r.dish.dish} fridge`} tone="cyan" />
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-xs">
              <p className="text-zinc-400">
                Next hour <span className="font-bold text-white">~{fmt1(r.nextHour)}</span> · next 2 h <span className="font-bold text-white">~{fmt1(r.next2h)}</span> · reorder at{" "}
                <span className="font-bold text-white">{r.dish.reorder_at}</span>
              </p>
              {r.note && <p className="mt-1 text-xs font-semibold text-amber-soft">{r.note}</p>}
              <p className={cn("mt-1 text-sm font-semibold", r.status === "urgent" ? "text-rose-soft" : r.status === "soon" ? "text-amber-soft" : "text-brand-300")}>{r.action}</p>
            </div>

            <button
              onClick={() => k.cooked(r.dish, r.dish.batch_portions || 1)}
              className="mt-3 w-full cursor-pointer rounded-lg bg-brand-400/15 py-2 text-sm font-semibold text-brand-300 transition-colors hover:bg-brand-400/25"
            >
              Cooked +{r.dish.batch_portions || 1} (one batch)
            </button>
          </div>
        ))}
      </div>

      {idle.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{STATUS_META.not_needed.label}</span>
          {idle.map((r) => (
            <Badge key={r.dish.id} tone="neutral">
              {r.dish.dish}
            </Badge>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
          <Flame className="h-4 w-4 text-brand-300" /> Kitchen right now
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p className="text-zinc-300"><Timer className="mr-1 inline h-3.5 w-3.5 text-zinc-500" />Avg wait today <b className="text-white">{speed.avgWait === null ? "—" : `${speed.avgWait.toFixed(1)} min`}</b></p>
          <p className="text-zinc-300">Most delayed dish <b className="text-white">{speed.mostDelayed ? `${speed.mostDelayed.dish} (${Math.round(speed.mostDelayed.minutes)} min)` : "—"}</b></p>
          <p className="text-zinc-300">Busiest station <b className="text-white">{speed.busiestStation ? `${stationLabel(speed.busiestStation.station)} (${speed.busiestStation.qty})` : "—"}</b></p>
          <p className="text-zinc-300">Pans needed <b className="text-white">{speed.pansNow}</b> · fryer <b className="text-white">{speed.fryerLoad}</b></p>
        </div>
        {speed.over15 > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-rose-soft">
            <AlertTriangle className="h-3.5 w-3.5" /> {speed.over15} order{speed.over15 > 1 ? "s" : ""} waiting over 15 minutes — see the Kitchen board.
          </p>
        )}
      </Card>
    </div>
  );
}
