import { ScrollView, View, Text } from "react-native";
import { Screen, Card, Button, Badge, Muted } from "@/components/ui";
import { useKitchenOrders, useKitchenMutation } from "@/lib/hooks";
import { agoMins } from "@/lib/format";
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

function Ticket({ order }: { order: Order }) {
  const mutate = useKitchenMutation();
  const next = NEXT[order.kitchen_status];
  const mins = agoMins(order.created_at);
  return (
    <Card className="mb-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-bold text-white">#{order.order_number}</Text>
        <Badge tone={TONE[order.kitchen_status]}>{order.kitchen_status.toUpperCase()}</Badge>
      </View>
      <Muted className="mt-0.5">
        {order.table_id ? `Table ${order.table_id} · ` : ""}
        {mins}m ago
      </Muted>
      <View className="mt-3 gap-1.5">
        {order.items.map((l, i) => (
          <View key={i} className="flex-row items-center gap-2">
            <Text className="text-base font-bold text-brand-300">{l.qty}×</Text>
            <Text className="text-base text-white">{l.name}</Text>
          </View>
        ))}
      </View>
      {next ? (
        <Button
          title={ACTION[order.kitchen_status]}
          className="mt-4"
          variant={order.kitchen_status === "ready" ? "primary" : "ghost"}
          loading={mutate.isPending}
          onPress={() => mutate.mutate({ id: order.id, status: next })}
        />
      ) : null}
    </Card>
  );
}

export default function Kitchen() {
  const ordersQ = useKitchenOrders();
  const orders = ordersQ.data ?? [];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="py-3 pb-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-white">Live tickets</Text>
          <Badge tone="accent">{orders.length} active</Badge>
        </View>
        {orders.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">All caught up — no open tickets. 🎉</Muted>
          </Card>
        ) : (
          orders.map((o) => <Ticket key={o.id} order={o} />)
        )}
      </ScrollView>
    </Screen>
  );
}
