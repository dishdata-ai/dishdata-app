import { useMemo, useState } from "react";
import { ScrollView, View, Text, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Button, Badge, Muted } from "@/components/ui";
import { useKitchenOrders, useKitchenMutation, useKitchenLineMutation } from "@/lib/hooks";
import { agoMins } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import type { Order, KitchenStatus } from "@/lib/types";

const NEXT: Record<KitchenStatus, KitchenStatus | null> = {
  new: "preparing",
  preparing: "ready",
  ready: "served",
  served: null,
};
const ACTION: Record<KitchenStatus, string> = {
  new: "Start cooking",
  preparing: "Mark ready",
  ready: "Mark served",
  served: "Done",
};
const TONE: Record<KitchenStatus, "rose" | "amber" | "green" | "neutral"> = {
  new: "rose",
  preparing: "amber",
  ready: "green",
  served: "neutral",
};

/** Where a ticket came from, when it wasn't rung up at the till. */
const SOURCE_LABEL: Record<string, string> = {
  storefront: "online",
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
  sumup: "SumUp",
};

const FILTERS: { key: "all" | KitchenStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
];

function Ticket({ order, highlighted }: { order: Order; highlighted: boolean }) {
  const status = useKitchenMutation();
  const line = useKitchenLineMutation();
  const next = NEXT[order.kitchen_status];
  const mins = agoMins(order.created_at);
  const urgent = mins >= 15 && order.kitchen_status !== "ready";
  const readyCount = order.items.filter((l) => l.ready).length;
  const partly = readyCount > 0 && readyCount < order.items.length;
  const fail = (e: unknown) => Alert.alert("Couldn't update the ticket", errorMessage(e));

  return (
    <Card
      className={`mb-3 ${urgent ? "border-rose-soft/40" : ""} ${partly ? "border-brand-400/40" : ""} ${highlighted ? "border-accent-400" : ""}`}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-lg font-bold text-white">#{order.order_number}</Text>
          {partly ? <Badge tone="green">{`${readyCount}/${order.items.length} ready`}</Badge> : null}
        </View>
        <Badge tone={TONE[order.kitchen_status]}>{order.kitchen_status.toUpperCase()}</Badge>
      </View>
      <Muted className="mt-0.5">
        <Text className={urgent ? "text-rose-soft" : undefined}>{mins}m ago</Text>
        {order.table_id ? ` · Table ${order.table_id}` : ""}
        {order.order_type !== "dine_in" ? ` · ${order.order_type.replace("_", "-")}` : ""}
        {order.guest_name ? ` · ${order.guest_name}` : ""}
        {SOURCE_LABEL[order.source] ? ` · ${SOURCE_LABEL[order.source]}` : ""}
      </Muted>

      <View className="mt-3 gap-1">
        {order.items.map((l, i) => (
          <Pressable
            key={i}
            onPress={() =>
              line.mutate({ order, index: i, ready: !l.ready }, { onError: fail })
            }
            accessibilityLabel={l.ready ? `Undo ${l.name} ready` : `Mark ${l.name} ready`}
            className={`flex-row items-center gap-3 rounded-lg px-2 py-2 active:opacity-70 ${l.ready ? "bg-brand-400/10" : ""}`}
          >
            <View
              className={`h-7 w-7 items-center justify-center rounded-md ${l.ready ? "bg-brand-400" : "bg-white/10"}`}
            >
              {l.ready ? (
                <Ionicons name="checkmark" size={18} color="#04120c" />
              ) : (
                <Text className="text-sm font-bold text-white">{l.qty}</Text>
              )}
            </View>
            <Text className={`flex-1 text-base ${l.ready ? "text-brand-300" : "text-white"}`}>
              {l.ready && l.qty > 1 ? `${l.qty}× ` : ""}
              {l.name}
            </Text>
            {l.ready ? <Text className="text-[10px] font-bold uppercase text-brand-300">ready</Text> : null}
          </Pressable>
        ))}
      </View>

      {order.kitchen_notes ? (
        <View className="mt-3 flex-row items-start gap-2 rounded-lg bg-amber-soft/10 p-2.5">
          <Ionicons name="document-text-outline" size={14} color={colors.amber} />
          <Text className="flex-1 text-xs text-amber-soft">{order.kitchen_notes}</Text>
        </View>
      ) : null}

      {next ? (
        <Button
          title={ACTION[order.kitchen_status]}
          className="mt-4"
          variant={order.kitchen_status === "ready" ? "primary" : "ghost"}
          loading={status.isPending}
          onPress={() => status.mutate({ id: order.id, status: next }, { onError: fail })}
        />
      ) : null}
    </Card>
  );
}

/** The live ticket board: ready-to-pick-up strip, what still has to be made, then the tickets. */
export default function Board() {
  const ordersQ = useKitchenOrders();
  const [filter, setFilter] = useState<"all" | KitchenStatus>("all");
  const [flashId, setFlashId] = useState<string | null>(null);

  // Same cut-off as the website: ignore anything older than 12 hours (a ticket nobody closed yesterday).
  const active = useMemo(
    () =>
      (ordersQ.data ?? []).filter(
        (o) =>
          o.kitchen_status !== "served" &&
          o.status !== "void" &&
          Date.now() - new Date(o.created_at).getTime() < 12 * 3600000,
      ),
    [ordersQ.data],
  );

  const pickups = useMemo(
    () =>
      active
        .filter((o) => o.items.some((l) => l.ready))
        .map((o) => ({ order: o, lines: o.items.filter((l) => l.ready), complete: o.items.every((l) => l.ready) }))
        .sort((a, b) => a.order.created_at.localeCompare(b.order.created_at)),
    [active],
  );

  // What still has to be cooked across every waiting ticket, biggest first (batch cooking).
  const toMake = useMemo(() => {
    const totals = new Map<string, { qty: number; orders: Set<string> }>();
    for (const o of active) {
      if (o.kitchen_status === "ready") continue;
      for (const l of o.items) {
        if (l.ready) continue;
        const t = totals.get(l.name) ?? { qty: 0, orders: new Set<string>() };
        t.qty += l.qty;
        t.orders.add(o.order_number);
        totals.set(l.name, t);
      }
    }
    return [...totals.entries()]
      .map(([name, t]) => ({ name, qty: t.qty, orders: t.orders.size }))
      .sort((a, b) => b.qty - a.qty);
  }, [active]);

  const count = (s: KitchenStatus) => active.filter((o) => o.kitchen_status === s).length;
  const shown = active
    .filter((o) => filter === "all" || o.kitchen_status === filter)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const flash = (id: string) => {
    setFilter("all");
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2500);
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-3 pb-6 pt-3">
      {pickups.length > 0 ? (
        <Card className="border-brand-400/30">
          <View className="mb-2 flex-row items-center gap-2">
            <Ionicons name="bag-check-outline" size={18} color={colors.brand300} />
            <Text className="text-base font-semibold text-white">Ready to pick up</Text>
          </View>
          <View className="gap-2">
            {pickups.map(({ order, lines, complete }) => (
              <Pressable
                key={order.id}
                onPress={() => flash(order.id)}
                className="rounded-xl border border-brand-400/30 bg-brand-400/10 px-3 py-2 active:opacity-70"
              >
                <Text className="text-sm font-bold text-white">
                  #{order.order_number}
                  {order.guest_name ? ` · ${order.guest_name}` : ""}
                  {!complete ? <Text className="font-normal text-zinc-400"> (more coming)</Text> : null}
                </Text>
                <Text className="text-sm text-brand-300">{lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {toMake.length > 0 ? (
        <View>
          <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Still to make</Text>
          <View className="flex-row flex-wrap gap-2">
            {toMake.map((m) => (
              <View key={m.name} className="rounded-full bg-white/[0.06] px-3 py-1.5">
                <Text className="text-xs text-zinc-200">
                  <Text className="font-bold text-white">{m.qty}×</Text> {m.name}
                  {m.orders > 1 ? <Text className="text-zinc-500"> · {m.orders} orders</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-none" contentContainerClassName="gap-2">
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            className={`self-start rounded-full border px-4 py-2 ${
              filter === f.key ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
            }`}
          >
            <Text className={`text-sm font-semibold ${filter === f.key ? "text-black" : "text-zinc-300"}`}>
              {f.label} {f.key === "all" ? active.length : count(f.key)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {shown.length === 0 ? (
        <Card>
          <Muted className="py-6 text-center">
            {active.length === 0 ? "The line is clear — no open tickets." : "Nothing in this stage."}
          </Muted>
        </Card>
      ) : (
        <View>
          {shown.map((o) => (
            <Ticket key={o.id} order={o} highlighted={flashId === o.id} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
