"use client";

import { Card } from "@/components/ui";
import { METHODS } from "@/data/kitchen-standards";
import { MethodChip, stationLabel } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";

const RULES = [
  "Use the same ladle, scoop or tray for every portion — never by eye.",
  "Weigh the first three portions of every new batch against the standard.",
  "Label every container with the dish, time cooked and discard-by time.",
  "Hot food is held at 65 °C or above; anything past its max hold time is discarded and logged as waste.",
  "Cool leftovers fast, keep them covered and chilled, and reheat piping hot before holding.",
  "Cook the smallest batch that covers the next 1–2 hours — never the whole day at once.",
  "Fried items are fried to order; nothing fried sits in the bain-marie.",
];

export default function Standards({ k }: { k: KitchenOpsCtx }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-line text-left text-[10px] tracking-wide text-zinc-500 uppercase">{["Dish", "Method", "Portion", "Container", "Hold", "Batch", "Station", "Recipe"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {k.dishes.map((d) => (
                <tr key={d.id} className="border-b border-line/50 align-top">
                  <td className="px-3 py-2 font-semibold text-white">{d.dish}{d.frozen && <span className="ml-1.5 rounded bg-accent-400/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-400">FROZEN</span>}{d.notes && <p className="mt-0.5 max-w-xs text-xs font-normal text-zinc-500">{d.notes}</p>}</td>
                  <td className="px-3 py-2"><MethodChip method={d.method} /></td>
                  <td className="px-3 py-2 text-zinc-300">{d.portion}{d.portion_g ? ` · ${d.portion_g} g` : ""}</td>
                  <td className="px-3 py-2 text-zinc-300">{d.container || "—"}</td>
                  <td className="px-3 py-2 text-zinc-300">{d.hold_temp_c ? `${d.hold_temp_c} °C · ${d.max_hold_min} min` : "—"}</td>
                  <td className="px-3 py-2 text-zinc-300">{d.batch_portions}</td>
                  <td className="px-3 py-2 text-zinc-300">{stationLabel(d.station)}</td>
                  <td className="px-3 py-2 text-xs">{k.money(d).cost !== null ? <span className="text-brand-300">linked · €{k.money(d).cost!.toFixed(2)}</span> : <span className="text-zinc-600">not linked</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">Consistency rules</h3>
            <ul className="list-disc space-y-1.5 pl-4 text-xs text-zinc-300">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold text-white">How each method works</h3>
            <ul className="space-y-2 text-xs">{METHODS.map((m) => <li key={m.id}><p className="font-semibold text-white">{m.label}</p><p className="text-zinc-400">{m.how}</p></li>)}</ul>
          </Card>
        </div>
      </div>
      <p className="text-xs text-zinc-500">Hold temperatures and times are starting values — set the final limits in Kokoland&apos;s HACCP plan. Edit any dish on the Menu &amp; methods tab.</p>
    </div>
  );
}
