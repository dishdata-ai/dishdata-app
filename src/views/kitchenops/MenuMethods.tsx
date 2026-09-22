"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, Button, Input, Modal, Field, Select, Textarea, Badge } from "@/components/ui";
import { METHODS, STATIONS, STATION_LABELS } from "@/data/kitchen-standards";
import { addKitchenDish, removeKitchenDish, updateKitchenDish, type DishPatch } from "@/lib/api/kitchen";
import { useInvalidate } from "@/lib/hooks/data";
import { ordersPerHour, wasteStats } from "@/lib/kitchen-ops";
import { toast } from "@/lib/toast";
import { MethodChip, fmt1, stationLabel } from "./shared";
import type { KitchenOpsCtx } from "./useKitchenOps";
import type { KitchenDish } from "@/lib/api/database.types";

const num = (v: string) => (v === "" ? 0 : Number(v));
const numOrNull = (v: string) => (v === "" ? null : Number(v));

function EditDish({ dish, orgId, onDone }: { dish: KitchenDish; orgId: string; onDone: () => void }) {
  const invalidate = useInvalidate();
  const [f, setF] = useState({ ...dish });
  const set = <K extends keyof KitchenDish>(key: K, value: KitchenDish[K]) => setF((p) => ({ ...p, [key]: value }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const { id: _id, org_id: _o, ...patch } = f;
    void _id; void _o;
    try {
      await updateKitchenDish(orgId, dish.id, patch as DishPatch);
      invalidate("kitchen_dishes");
      toast.success("Saved", dish.dish);
      onDone();
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const numField = (label: string, k: keyof KitchenDish, hint?: string, nullable?: boolean) => (
    <Field key={k} label={label}>
      <Input
        type="number"
        value={(f[k] as number | null) ?? ""}
        placeholder={hint}
        onChange={(e) => set(k, (nullable ? numOrNull(e.target.value) : num(e.target.value)) as never)}
      />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dish / component"><Input value={f.dish} onChange={(e) => set("dish", e.target.value)} /></Field>
        <Field label="Order-line words that count as this dish (comma-separated)">
          <Input value={f.terms} onChange={(e) => set("terms", e.target.value.toLowerCase())} placeholder="e.g. beef curry, beef mix" />
        </Field>
        <Field label="Production method">
          <Select value={f.method} onChange={(e) => set("method", e.target.value as KitchenDish["method"])}>
            {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Bain-marie">
          <Select value={f.bain_marie} onChange={(e) => set("bain_marie", e.target.value as KitchenDish["bain_marie"])}>
            <option value="yes">Yes</option><option value="limited">Limited</option><option value="no">No</option>
          </Select>
        </Field>
        <Field label="Station">
          <Select value={f.station} onChange={(e) => set("station", e.target.value)}>
            {STATIONS.map((s) => <option key={s} value={s}>{STATION_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Container / GN size"><Input value={f.container} onChange={(e) => set("container", e.target.value)} placeholder="GN 1/3" /></Field>
        <Field label="Standard portion"><Input value={f.portion} onChange={(e) => set("portion", e.target.value)} placeholder="1 ladle, 5 pieces" /></Field>
        {numField("Portion weight (g)", "portion_g", undefined, true)}
        <Field label="Supply">
          <label className="flex cursor-pointer items-center gap-2 pt-2 text-sm text-zinc-300">
            <input type="checkbox" checked={f.frozen} onChange={(e) => set("frozen", e.target.checked)} className="h-4 w-4 accent-brand-400" />
            Bought frozen (cook from frozen)
          </label>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {numField("Batch size (portions)", "batch_portions")}
        {numField("Ready at opening (% of need)", "open_pct", "0–1, e.g. 0.7")}
        {numField("Minimum stock (portions)", "min_portions")}
        {numField("Reorder point (portions)", "reorder_at")}
        {numField("Prep time (min)", "prep_minutes")}
        {numField("Final finishing time (min)", "finish_minutes")}
        {numField("Target customer wait (min)", "target_wait_min")}
        {numField("Holding temperature (°C)", "hold_temp_c", undefined, true)}
        {numField("Max holding time (min)", "max_hold_min", undefined, true)}
      </div>
      <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <Button className="w-full" disabled={!f.dish.trim() || saving} onClick={save}>Save</Button>
    </div>
  );
}

export default function MenuMethods({ k }: { k: KitchenOpsCtx }) {
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState<KitchenDish | null>(null);
  const [newDish, setNewDish] = useState("");
  const waste = useMemo(() => new Map(wasteStats(k.log, 30).map((w) => [w.dish, w])), [k.log]);
  const wd = k.now.getDay() === 1 ? k.defaultDay : k.now.getDay();

  const add = async () => {
    try {
      await addKitchenDish(k.org!.id, newDish, k.dishes.length + 1);
      setNewDish("");
      invalidate("kitchen_dishes");
    } catch (e) {
      toast.error("Could not add", e instanceof Error ? e.message : "");
    }
  };
  const remove = async (d: KitchenDish) => {
    try {
      await removeKitchenDish(k.org!.id, d.id);
      invalidate("kitchen_dishes");
    } catch (e) {
      toast.error("Could not remove", e instanceof Error ? e.message : "");
    }
  };

  const th = "whitespace-nowrap px-2.5 py-2 text-left text-[10px] font-semibold tracking-wide text-zinc-500 uppercase";
  const td = "whitespace-nowrap px-2.5 py-2 tabular-nums text-zinc-200";

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {METHODS.map((m) => {
          const list = k.dishes.filter((d) => d.method === m.id);
          return (
            <Card key={m.id} className="p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{m.label}</p>
                <Badge tone="neutral">{list.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{m.how}</p>
              <p className="mt-2 text-xs text-zinc-300">{list.map((d) => d.dish).join(", ") || "—"}</p>
            </Card>
          );
        })}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1500px] text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Dish", "Method", "Portion", "Prep batch", "Open %", "Min", "Reorder", "Replenish", "Hot", "Fridge", "Left", "Avg /h", "Peak /h", "Prep", "Finish", "Target wait", "Hold °C", "Max hold", "Container", "Station", "Food cost", "Price", "Waste 30d", "Waste €", "Notes", ""].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {k.dishes.map((d) => {
              const oph = ordersPerHour(k.model, d.id, wd);
              const w = waste.get(d.dish);
              const m = k.money(d);
              return (
                <tr key={d.id} className="border-b border-line/50 hover:bg-white/[0.02]">
                  <td className={`${td} font-semibold text-white`}>{d.dish}{d.frozen && <span className="ml-1.5 rounded bg-accent-400/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-400">FROZEN</span>}</td>
                  <td className={td}><MethodChip method={d.method} /></td>
                  <td className={td}>{d.portion}{d.portion_g ? ` · ${d.portion_g} g` : ""}</td>
                  <td className={td}>{d.batch_portions}</td>
                  <td className={td}>{Math.round(d.open_pct * 100)}%</td>
                  <td className={td}>{d.min_portions}</td>
                  <td className={td}>{d.reorder_at}</td>
                  <td className={td}>{d.batch_portions}</td>
                  <td className={td}>{d.hot_portions}</td>
                  <td className={td}>{d.fridge_portions}</td>
                  <td className={`${td} font-bold text-brand-300`}>{d.hot_portions + d.fridge_portions}</td>
                  <td className={td}>{fmt1(oph.avg)}</td>
                  <td className={td}>{fmt1(oph.peak)}</td>
                  <td className={td}>{d.prep_minutes} min</td>
                  <td className={td}>{d.finish_minutes} min</td>
                  <td className={td}>{d.target_wait_min} min</td>
                  <td className={td}>{d.hold_temp_c ?? "—"}</td>
                  <td className={td}>{d.max_hold_min ? `${d.max_hold_min} min` : "—"}</td>
                  <td className={td}>{d.container || "—"}</td>
                  <td className={td}>{stationLabel(d.station)}</td>
                  <td className={td}>{m.cost === null ? "—" : `€${m.cost.toFixed(2)}`}</td>
                  <td className={td}>{m.price === null ? "—" : `€${m.price.toFixed(2)}`}</td>
                  <td className={td}>{w ? fmt1(w.wasted) : "—"}</td>
                  <td className={td}>{w ? `€${w.value.toFixed(2)}` : "—"}</td>
                  <td className={`${td} max-w-[260px] truncate text-xs text-zinc-400`} title={d.notes}>{d.notes || "—"}</td>
                  <td className={td}>
                    {k.isManager && (
                      <span className="flex items-center gap-1">
                        <button onClick={() => setEditing(d)} aria-label={`Edit ${d.dish}`} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => remove(d)} aria-label={`Remove ${d.dish}`} className="cursor-pointer rounded p-1 text-zinc-600 hover:text-rose-soft"><Trash2 className="h-3.5 w-3.5" /></button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-zinc-500">
        Portion sizes, times and holding limits start as estimates — confirm them with the chef. Avg and peak per hour are for the current service day.
      </p>

      {k.isManager && (
        <div className="flex items-center gap-2">
          <Input value={newDish} onChange={(e) => setNewDish(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newDish.trim() && add()} placeholder="Add a component, e.g. Fish Curry…" className="max-w-xs" />
          <Button disabled={!newDish.trim()} onClick={add}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.dish}` : ""} wide>
        {editing && <EditDish dish={editing} orgId={k.org!.id} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
