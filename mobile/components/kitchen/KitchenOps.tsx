import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Card, Badge, Muted } from "@/components/ui";
import { useKitchenOps, type KitchenOpsCtx } from "@/lib/hooks";
import { METHODS, STATION_LABELS, type Station } from "@/lib/kitchen-standards";
import {
  prepBoard,
  sortByUrgency,
  speedStats,
  STATUS_META,
  SERVICE_BLOCKS,
  WEEKDAYS,
  type LiveRow,
  type LiveStatus,
  type ServiceBlock,
} from "@/lib/kitchen-ops";
import { colors } from "@/lib/theme";
import { useEffect } from "react";

const fmt1 = (n: number) => (Math.abs(n) >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));
const methodLabel = (m: string) => METHODS.find((x) => x.id === m)?.short ?? m;
const stationLabel = (s: string) => STATION_LABELS[s as Station] ?? s;

const BORDER: Record<LiveStatus, string> = {
  urgent: "border-rose-soft/60",
  soon: "border-amber-soft/50",
  enough: "border-line",
  not_needed: "border-line/60 opacity-70",
};

const MULTIPLIERS = [
  { v: 0.8, label: "Quiet ×0.8" },
  { v: 1, label: "Normal" },
  { v: 1.25, label: "Busy ×1.25" },
  { v: 1.5, label: "Very busy ×1.5" },
];

function Pill({ active, onPress, children }: { active: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      onPress={onPress}
      className={`self-start rounded-full border px-4 py-2 ${
        active ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
      }`}
    >
      <Text className={`text-sm font-semibold ${active ? "text-black" : "text-zinc-300"}`}>{children}</Text>
    </Pressable>
  );
}

/** Big − number + control for a live count. */
function Counter({
  value,
  onChange,
  label,
  tone = "brand",
}: {
  value: number;
  onChange: (delta: number) => void;
  label: string;
  tone?: "brand" | "cyan";
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={() => onChange(-1)}
        accessibilityLabel={`One less ${label}`}
        className="h-11 w-11 items-center justify-center rounded-xl bg-white/[0.08] active:opacity-60"
      >
        <Ionicons name="remove" size={22} color={colors.white} />
      </Pressable>
      <Text className={`min-w-[28px] text-center text-3xl font-bold ${tone === "cyan" ? "text-accent-400" : "text-brand-300"}`}>
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(1)}
        accessibilityLabel={`One more ${label}`}
        className="h-11 w-11 items-center justify-center rounded-xl bg-brand-400/20 active:opacity-60"
      >
        <Ionicons name="add" size={22} color={colors.brand300} />
      </Pressable>
    </View>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "rose" | "amber" | "green" }) {
  const text = tone === "rose" ? "text-rose-soft" : tone === "amber" ? "text-amber-soft" : tone === "green" ? "text-brand-300" : "text-white";
  return (
    <View className="min-w-[46%] flex-1 rounded-xl border border-line bg-white/[0.02] p-3">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</Text>
      <Text className={`mt-0.5 text-2xl font-bold ${text}`}>{value}</Text>
      {sub ? <Text className="text-xs text-zinc-500">{sub}</Text> : null}
    </View>
  );
}

function LiveKitchen({ k }: { k: KitchenOpsCtx }) {
  const sorted = useMemo(() => sortByUrgency(k.rows), [k.rows]);
  const speed = useMemo(() => speedStats(k.orders, k.dishes, k.now.getTime()), [k.orders, k.dishes, k.now]);
  const urgent = sorted.filter((r) => r.status === "urgent");
  const soon = sorted.filter((r) => r.status === "soon");
  const active = sorted.filter((r) => r.status !== "not_needed");
  const idle = sorted.filter((r) => r.status === "not_needed");
  const next = [...urgent, ...soon].slice(0, 4);

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-3">
        <Stat
          label="Running out"
          value={String(urgent.length)}
          sub={urgent.length ? urgent.slice(0, 3).map((r) => r.dish.dish).join(", ") : "nothing urgent"}
          tone={urgent.length ? "rose" : "green"}
        />
        <Stat
          label="Prepare soon"
          value={String(soon.length)}
          sub={soon.length ? soon.slice(0, 3).map((r) => r.dish.dish).join(", ") : "all good"}
          tone={soon.length ? "amber" : "green"}
        />
        <Stat label="Orders waiting" value={String(speed.waiting)} sub={speed.waiting ? `oldest ${Math.round(speed.oldest)} min` : "line is clear"} />
        <Stat
          label="Over 10 min"
          value={String(speed.over10)}
          sub={speed.over15 ? `${speed.over15} over 15 min` : "none over 15"}
          tone={speed.over15 ? "rose" : speed.over10 ? "amber" : "green"}
        />
      </View>

      {next.length > 0 ? (
        <Card className="border-brand-400/30">
          <View className="mb-2 flex-row items-center gap-2">
            <Ionicons name="restaurant-outline" size={18} color={colors.brand300} />
            <Text className="text-base font-semibold text-white">Prepare next</Text>
          </View>
          {next.map((r, i) => (
            <View key={r.dish.id} className="mb-1.5 flex-row items-baseline gap-3">
              <Text className="text-lg font-bold text-brand-300">{i + 1}</Text>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-white">{r.dish.dish}</Text>
                <Text className="text-sm text-zinc-300">{r.action}</Text>
                {r.waiting > 0 ? <Text className="text-xs font-semibold text-rose-soft">{r.waiting} on open tickets</Text> : null}
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {k.dishes.length === 0 ? (
        <Card>
          <Muted className="py-4 text-center">No kitchen dishes set up yet — a manager adds them on the website (Kitchen Ops → Menu &amp; methods).</Muted>
        </Card>
      ) : null}

      {active.map((r: LiveRow) => (
        <View key={r.dish.id} className={`rounded-2xl border bg-surface p-4 ${BORDER[r.status]}`}>
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="text-base font-bold text-white">{r.dish.dish}</Text>
              <Text className="mt-0.5 text-xs text-zinc-500">
                {methodLabel(r.dish.method)} · {stationLabel(r.dish.station)}
              </Text>
            </View>
            <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge>
          </View>

          <View className="mt-3 flex-row justify-between">
            <View>
              <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {r.dish.bain_marie === "yes" ? "In bain-marie" : "Hot / ready"}
              </Text>
              <Counter value={r.hot} onChange={(d) => k.adjust(r.dish, "hot_portions", d)} label={`${r.dish.dish} hot`} />
            </View>
            <View>
              <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {r.dish.frozen ? "Freezer stock" : "Fridge / prepped"}
              </Text>
              <Counter value={r.fridge} onChange={(d) => k.adjust(r.dish, "fridge_portions", d)} label={`${r.dish.dish} fridge`} tone="cyan" />
            </View>
          </View>

          <View className="mt-3 rounded-lg bg-black/20 px-3 py-2">
            <Text className="text-xs text-zinc-400">
              Next hour <Text className="font-bold text-white">~{fmt1(r.nextHour)}</Text> · next 2 h{" "}
              <Text className="font-bold text-white">~{fmt1(r.next2h)}</Text> · reorder at{" "}
              <Text className="font-bold text-white">{r.dish.reorder_at}</Text>
            </Text>
            {r.note ? <Text className="mt-1 text-xs font-semibold text-amber-soft">{r.note}</Text> : null}
            <Text
              className={`mt-1 text-sm font-semibold ${
                r.status === "urgent" ? "text-rose-soft" : r.status === "soon" ? "text-amber-soft" : "text-brand-300"
              }`}
            >
              {r.action}
            </Text>
          </View>

          <Pressable
            onPress={() => k.cooked(r.dish, r.dish.batch_portions || 1)}
            className="mt-3 items-center rounded-xl bg-brand-400/15 py-3 active:opacity-70"
          >
            <Text className="text-sm font-semibold text-brand-300">Cooked +{r.dish.batch_portions || 1} (one batch)</Text>
          </Pressable>
        </View>
      ))}

      {idle.length > 0 ? (
        <View>
          <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {STATUS_META.not_needed.label}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {idle.map((r) => (
              <Badge key={r.dish.id}>{r.dish.dish}</Badge>
            ))}
          </View>
        </View>
      ) : null}

      <Card>
        <Text className="mb-2 text-base font-semibold text-white">Kitchen right now</Text>
        <View className="gap-1.5">
          <Text className="text-sm text-zinc-300">
            Avg wait today <Text className="font-bold text-white">{speed.avgWait === null ? "—" : `${speed.avgWait.toFixed(1)} min`}</Text>
          </Text>
          <Text className="text-sm text-zinc-300">
            Most delayed dish{" "}
            <Text className="font-bold text-white">
              {speed.mostDelayed ? `${speed.mostDelayed.dish} (${Math.round(speed.mostDelayed.minutes)} min)` : "—"}
            </Text>
          </Text>
          <Text className="text-sm text-zinc-300">
            Busiest station{" "}
            <Text className="font-bold text-white">
              {speed.busiestStation ? `${stationLabel(speed.busiestStation.station)} (${speed.busiestStation.qty})` : "—"}
            </Text>
          </Text>
          <Text className="text-sm text-zinc-300">
            Pans needed <Text className="font-bold text-white">{speed.pansNow}</Text> · fryer{" "}
            <Text className="font-bold text-white">{speed.fryerLoad}</Text>
          </Text>
        </View>
      </Card>
    </View>
  );
}

const PREP_KEY = "kitchenops:prep-done";
const todayKey = () => new Date().toDateString();

/** Ticks on the prep list survive closing the app for the rest of the day (and reset the next day). */
function usePrepDone() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    AsyncStorage.getItem(PREP_KEY)
      .then((raw) => {
        const v = raw ? JSON.parse(raw) : null;
        if (v?.day === todayKey()) setDone(v.done ?? {});
      })
      .catch(() => undefined);
  }, []);
  const toggle = (id: string) =>
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      AsyncStorage.setItem(PREP_KEY, JSON.stringify({ day: todayKey(), done: next })).catch(() => undefined);
      return next;
    });
  return { done, toggle };
}

function TodayPrep({ k, multiplier }: { k: KitchenOpsCtx; multiplier: number }) {
  const [day, setDay] = useState(k.defaultDay);
  const { done, toggle } = usePrepDone();
  const boards = useMemo(
    () => ({
      lunch: prepBoard(k.model, k.dishes, day, "lunch", multiplier),
      dinner: prepBoard(k.model, k.dishes, day, "dinner", multiplier),
    }),
    [k.model, k.dishes, day, multiplier],
  );
  const isToday = day === k.now.getDay();

  return (
    <View className="gap-4">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-none" contentContainerClassName="gap-2">
        {WEEKDAYS.map((d) => (
          <Pill key={d.day} active={day === d.day} onPress={() => setDay(d.day)}>
            {d.short}
          </Pill>
        ))}
      </ScrollView>
      <Muted>
        Based on {k.model.samples[day]} service day{k.model.samples[day] === 1 ? "" : "s"} · +15% safety stock
        {multiplier !== 1 ? ` · busy-day ×${multiplier}` : ""}
        {isToday ? " · counts include what you already have" : ""}
      </Muted>

      {(Object.keys(SERVICE_BLOCKS) as ServiceBlock[]).map((block) => {
        const lines = boards[block];
        const busy = lines.filter((l) => l.opening > 0);
        const idle = lines.filter((l) => l.opening === 0);
        return (
          <Card key={block} className="p-0">
            <View className="flex-row items-baseline justify-between border-b border-line p-4">
              <Text className="text-xl font-bold text-white">{SERVICE_BLOCKS[block].label}</Text>
              <Text className="text-xs text-zinc-500">
                {SERVICE_BLOCKS[block].from}:00–{SERVICE_BLOCKS[block].to + 1}:00
              </Text>
            </View>
            {busy.map((l, i) => {
              const id = `${block}:${l.dish.id}`;
              const ticked = !!done[id];
              return (
                <Pressable
                  key={l.dish.id}
                  onPress={() => toggle(id)}
                  className={`flex-row items-start gap-3 p-4 active:opacity-70 ${i > 0 ? "border-t border-line/60" : ""}`}
                >
                  <Ionicons
                    name={ticked ? "checkbox" : "square-outline"}
                    size={24}
                    color={ticked ? colors.brand400 : colors.zinc500}
                  />
                  <View className="flex-1">
                    <Text className={`text-sm font-semibold ${ticked ? "text-zinc-500 line-through" : "text-white"}`}>
                      {l.dish.dish} <Text className="font-normal text-zinc-400">— {l.text}</Text>
                    </Text>
                    <Text className="mt-1 text-[11px] text-zinc-500">
                      {methodLabel(l.dish.method)} · expect ~{fmt1(l.expected)}
                      {isToday && l.usable > 0 ? ` · have ${l.usable}` : ""}
                      {l.toPrep > 0 && isToday ? <Text className="font-semibold text-amber-soft"> · make {l.toPrep} now</Text> : null}
                    </Text>
                  </View>
                  <Text className="text-2xl font-bold text-brand-300">{l.opening}</Text>
                </Pressable>
              );
            })}
            {busy.length === 0 ? <Text className="p-4 text-sm text-zinc-500">No sales history for this day yet.</Text> : null}
            {idle.length > 0 ? (
              <Text className="border-t border-line p-4 text-xs text-zinc-500">
                Not needed unless ordered: {idle.map((l) => l.dish.dish).join(", ")}
              </Text>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

const OPS_VIEWS = [
  { id: "live", label: "Live Kitchen" },
  { id: "prep", label: "Today's Prep" },
] as const;

/** Batch-cook planning on the phone: live hot/fridge counts and today's prep list. The deeper analysis stays on the website. */
export default function KitchenOps() {
  const [view, setView] = useState<(typeof OPS_VIEWS)[number]["id"]>("live");
  const [multiplier, setMultiplier] = useState(1);
  const k = useKitchenOps(multiplier);
  const learning = k.model.serviceDays < 14;

  if (k.loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color={colors.brand400} />
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-3">
      <View className="flex-row gap-2">
        {OPS_VIEWS.map((v) => (
          <Pressable
            key={v.id}
            onPress={() => setView(v.id)}
            className={`flex-1 items-center rounded-xl border py-2.5 ${
              view === v.id ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
            }`}
          >
            <Text className={`text-sm font-semibold ${view === v.id ? "text-brand-300" : "text-zinc-400"}`}>{v.label}</Text>
          </Pressable>
        ))}
      </View>

      <View>
        <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Busy-day factor</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-none" contentContainerClassName="gap-2">
          {MULTIPLIERS.map((m) => (
            <Pill key={m.v} active={multiplier === m.v} onPress={() => setMultiplier(m.v)}>
              {m.label}
            </Pill>
          ))}
        </ScrollView>
      </View>

      {learning ? (
        <Muted>
          Learning from {k.model.serviceDays} service day{k.model.serviceDays === 1 ? "" : "s"} of sales — forecasts
          sharpen as more days come in (about 3–4 weeks gives a solid weekday pattern).
        </Muted>
      ) : null}

      {view === "live" ? <LiveKitchen k={k} /> : <TodayPrep k={k} multiplier={multiplier} />}
    </ScrollView>
  );
}
