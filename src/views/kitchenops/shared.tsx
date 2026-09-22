"use client";

import { Minus, Plus } from "lucide-react";
import { Badge } from "@/components/ui";
import { METHODS, STATION_LABELS, type Station } from "@/data/kitchen-standards";
import { STATUS_META, type LiveStatus } from "@/lib/kitchen-ops";
import { cn } from "@/lib/utils";
import type { KitchenDish } from "@/lib/api/database.types";

export const methodLabel = (m: KitchenDish["method"]) => METHODS.find((x) => x.id === m)?.short ?? m;
export const stationLabel = (s: string) => STATION_LABELS[s as Station] ?? s;

export function MethodChip({ method }: { method: KitchenDish["method"] }) {
  const tone = { hot_hold: "amber", fridge_reheat: "cyan", pan_finish: "violet", fresh: "rose", batch_portion: "green", assembly: "neutral" } as const;
  return <Badge tone={tone[method]}>{methodLabel(method)}</Badge>;
}

export function StatusPill({ status }: { status: LiveStatus }) {
  const m = STATUS_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

/** Big − number + control for a live count. */
export function Counter({ value, onChange, label, tone = "brand" }: { value: number; onChange: (delta: number) => void; label: string; tone?: "brand" | "cyan" }) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => onChange(-1)}
        aria-label={`One less ${label}`}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-white/[0.06] text-white hover:bg-white/10 active:scale-95"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className={cn("min-w-[2ch] text-center font-display text-3xl font-bold tabular-nums", tone === "cyan" ? "text-accent-400" : "text-brand-300")}>{value}</span>
      <button
        onClick={() => onChange(1)}
        aria-label={`One more ${label}`}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-brand-400/20 text-brand-300 hover:bg-brand-400/30 active:scale-95"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Background shade for a heat-map cell (0..1). */
export const heat = (v: number, max: number) => {
  if (max <= 0 || v <= 0) return undefined;
  const a = Math.min(1, v / max);
  return { background: `rgba(52, 211, 153, ${0.08 + a * 0.5})` };
};

export const fmt1 = (n: number) => (Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));
export const minutes = (n: number | null) => (n === null ? "—" : `${n.toFixed(n < 10 ? 1 : 0)} min`);

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "rose" | "amber" | "green" }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{label}</p>
      <p className={cn("mt-1 font-display text-3xl font-bold tabular-nums", tone === "rose" ? "text-rose-soft" : tone === "amber" ? "text-amber-soft" : tone === "green" ? "text-brand-300" : "text-white")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

export const DayPicker = ({ value, onChange, days }: { value: number; onChange: (d: number) => void; days: { day: number; short: string }[] }) => (
  <div className="flex flex-wrap gap-1">
    {days.map((d) => (
      <button
        key={d.day}
        onClick={() => onChange(d.day)}
        className={cn(
          "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors",
          value === d.day ? "bg-brand-400/15 text-brand-300 ring-1 ring-brand-400/30" : "bg-white/[0.04] text-zinc-400 hover:text-white",
        )}
      >
        {d.short}
      </button>
    ))}
  </div>
);
