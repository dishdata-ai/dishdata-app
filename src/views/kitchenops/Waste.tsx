"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Card, Button, Field, Input, Select } from "@/components/ui";
import { deleteKitchenLog, logKitchen } from "@/lib/api/kitchen";
import { useInvalidate } from "@/lib/hooks/data";
import { logToday, wasteStats } from "@/lib/kitchen-ops";
import { toast } from "@/lib/toast";
import { Stat, fmt1 } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";

const REASONS = ["Unsold at end of service", "Over-cooked / burnt", "Dropped / spilled", "Held too long", "Returned by guest", "Prepared too much", "Other"];

export default function Waste({ k }: { k: KitchenOpsCtx }) {
  const invalidate = useInvalidate();
  const [dishId, setDishId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const w7 = useMemo(() => wasteStats(k.log, 7), [k.log]);
  const w30 = useMemo(() => wasteStats(k.log, 30), [k.log]);
  const today = useMemo(() => logToday(k.log, "wasted", k.now), [k.log, k.now]);
  const todayQty = today.reduce((s, e) => s + Number(e.portions), 0);
  const todayValue = today.reduce((s, e) => s + Number(e.value), 0);
  const cooked7 = w7.reduce((s, r) => s + r.cooked, 0);
  const wasted7 = w7.reduce((s, r) => s + r.wasted, 0);

  const submit = async () => {
    const dish = k.dishes.find((d) => d.id === dishId);
    const n = Number(qty);
    if (!dish || !(n > 0)) return;
    setBusy(true);
    try {
      const cost = k.money(dish).cost ?? 0;
      await logKitchen(k.org!.id, { dish: dish.dish, kind: "wasted", portions: n, value: +(n * cost).toFixed(2), reason, by: k.me });
      // Wasted food leaves the count: hot first, then the fridge.
      const fromHot = Math.min(n, dish.hot_portions);
      if (fromHot > 0) k.adjust(dish, "hot_portions", -fromHot);
      const fromFridge = Math.min(n - fromHot, dish.fridge_portions);
      if (fromFridge > 0) k.adjust(dish, "fridge_portions", -fromFridge);
      invalidate("kitchen_log");
      setQty("1");
      toast.success("Waste logged", `${n} × ${dish.dish}`);
    } catch (e) {
      toast.error("Could not log waste", e instanceof Error ? e.message : "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Wasted today" value={fmt1(todayQty)} sub="portions" tone={todayQty ? "amber" : "green"} />
        <Stat label="Waste value today" value={`€${todayValue.toFixed(2)}`} />
        <Stat label="Waste % (7 days)" value={cooked7 > 0 ? `${((wasted7 / cooked7) * 100).toFixed(1)}%` : "—"} sub={cooked7 > 0 ? `${fmt1(wasted7)} of ${fmt1(cooked7)} cooked` : "log what you cook to see this"} tone={cooked7 > 0 && wasted7 / cooked7 > 0.1 ? "rose" : undefined} />
        <Stat label="Waste value (30 days)" value={`€${w30.reduce((s, r) => s + r.value, 0).toFixed(2)}`} />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Log waste</h3>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end">
          <Field label="Dish">
            <Select value={dishId} onChange={(e) => setDishId(e.target.value)}>
              <option value="">Choose…</option>
              {k.dishes.map((d) => <option key={d.id} value={d.id}>{d.dish}</option>)}
            </Select>
          </Field>
          <Field label="Portions"><Input type="number" min={0.5} step={0.5} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Why">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</Select>
          </Field>
          <Button disabled={!dishId || !(Number(qty) > 0) || busy} onClick={submit}>Log</Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">By dish — last 30 days</div>
          {w30.length === 0 ? <p className="p-4 text-sm text-zinc-500">Nothing logged yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-[10px] tracking-wide text-zinc-500 uppercase">{["Dish", "Cooked", "Wasted", "Waste %", "Value", "Ran out"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {w30.map((r) => (
                  <tr key={r.dish} className="border-b border-line/50 tabular-nums">
                    <td className="px-3 py-2 font-semibold text-white">{r.dish}</td>
                    <td className="px-3 py-2 text-zinc-300">{fmt1(r.cooked)}</td>
                    <td className="px-3 py-2 text-zinc-300">{fmt1(r.wasted)}</td>
                    <td className={`px-3 py-2 font-bold ${r.pct !== null && r.pct >= 15 ? "text-rose-soft" : "text-white"}`}>{r.pct === null ? "—" : `${r.pct.toFixed(0)}%`}</td>
                    <td className="px-3 py-2 text-zinc-300">€{r.value.toFixed(2)}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.stockouts ? `${r.stockouts}×` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">Today&apos;s waste log</div>
          {today.length === 0 ? <p className="p-4 text-sm text-zinc-500">No waste logged today.</p> : (
            <ul className="divide-y divide-line/50">
              {today.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="font-display text-lg font-bold text-amber-soft tabular-nums">{fmt1(Number(e.portions))}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-white">{e.dish}</p>
                    <p className="text-xs text-zinc-500">{e.reason}{e.created_by ? ` · ${e.created_by}` : ""} · {new Date(e.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className="text-xs text-zinc-400">€{Number(e.value).toFixed(2)}</span>
                  {k.isManager && (
                    <button aria-label="Delete entry" onClick={async () => { await deleteKitchenLog(k.org!.id, e.id); invalidate("kitchen_log"); }} className="cursor-pointer text-zinc-600 hover:text-rose-soft"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
