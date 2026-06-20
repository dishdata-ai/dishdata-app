import { useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Badge, Muted, Button, Divider } from "@/components/ui";
import { useInventory, useStockAdjust } from "@/lib/hooks";
import { money } from "@/lib/format";
import { colors } from "@/lib/theme";
import type { InventoryItem } from "@/lib/types";

function Row({ item }: { item: InventoryItem }) {
  const adjust = useStockAdjust();
  const [open, setOpen] = useState(false);
  const low = item.stock < item.par_level * 0.5;
  const pct = Math.min(100, Math.round((item.stock / Math.max(1, item.par_level)) * 100));

  return (
    <View>
      <Pressable className="flex-row items-center gap-3 p-4" onPress={() => setOpen((o) => !o)}>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-white">{item.name}</Text>
            {low ? <Badge tone="rose">Low</Badge> : null}
          </View>
          <Muted className="mt-0.5">
            {item.stock} {item.unit} · par {item.par_level} · {money(item.unit_cost)}/{item.unit}
          </Muted>
          {/* Stock bar */}
          <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <View
              style={{ width: `${pct}%`, backgroundColor: low ? colors.rose : colors.brand400 }}
              className="h-full rounded-full"
            />
          </View>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.zinc500} />
      </Pressable>

      {open ? (
        <View className="flex-row gap-2 px-4 pb-4">
          <Button
            title="−1 waste"
            variant="danger"
            className="flex-1"
            loading={adjust.isPending}
            onPress={() => adjust.mutate({ itemId: item.id, delta: -1, reason: "waste" })}
          />
          <Button
            title="+1 count"
            variant="ghost"
            className="flex-1"
            loading={adjust.isPending}
            onPress={() => adjust.mutate({ itemId: item.id, delta: 1, reason: "count" })}
          />
        </View>
      ) : null}
      <Divider />
    </View>
  );
}

export default function Inventory() {
  const invQ = useInventory();
  const items = invQ.data ?? [];
  const low = items.filter((i) => i.stock < i.par_level * 0.5);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="py-3 pb-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-white">Stock</Text>
          {low.length > 0 ? (
            <Badge tone="rose">{low.length} below par</Badge>
          ) : (
            <Badge tone="green">All stocked</Badge>
          )}
        </View>
        <Card className="p-0">
          {items.map((it) => (
            <Row key={it.id} item={it} />
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
