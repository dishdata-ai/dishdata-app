import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Muted } from "@/components/ui";
import { useMenu, useCreateOrder } from "@/lib/hooks";
import { money } from "@/lib/format";
import { colors } from "@/lib/theme";
import type { Recipe, OrderLine } from "@/lib/types";

export default function Pos() {
  const menuQ = useMenu();
  const createOrder = useCreateOrder();
  const menu = menuQ.data ?? [];

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((m) => m.category)))],
    [menu],
  );
  const [cat, setCat] = useState("All");
  const [cart, setCart] = useState<Record<string, { rec: Recipe; qty: number }>>({});
  const [cartOpen, setCartOpen] = useState(false);

  const visible = cat === "All" ? menu : menu.filter((m) => m.category === cat);
  const lines = Object.values(cart);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.rec.price * l.qty, 0);

  const add = (rec: Recipe) =>
    setCart((c) => ({ ...c, [rec.id]: { rec, qty: (c[rec.id]?.qty ?? 0) + 1 } }));
  const remove = (rec: Recipe) =>
    setCart((c) => {
      const qty = (c[rec.id]?.qty ?? 0) - 1;
      const next = { ...c };
      if (qty <= 0) delete next[rec.id];
      else next[rec.id] = { rec, qty };
      return next;
    });

  const send = () => {
    const orderLines: OrderLine[] = lines.map((l) => ({
      recipe_id: l.rec.id,
      name: l.rec.name,
      qty: l.qty,
      price: l.rec.price,
    }));
    createOrder.mutate(
      { items: orderLines, tip: 0, table_id: null },
      {
        onSuccess: () => {
          setCart({});
          setCartOpen(false);
        },
      },
    );
  };

  return (
    <Screen>
      {/* Category pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 py-3"
      >
        {categories.map((c) => (
          <Pressable
            key={c}
            onPress={() => setCat(c)}
            className={`rounded-full border px-4 py-2 ${
              cat === c ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
            }`}
          >
            <Text className={`text-sm font-semibold ${cat === c ? "text-black" : "text-zinc-300"}`}>
              {c}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Menu grid */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-40">
        <View className="flex-row flex-wrap justify-between">
          {visible.map((item) => {
            const inCart = cart[item.id]?.qty ?? 0;
            return (
              <Pressable
                key={item.id}
                onPress={() => add(item)}
                className="mb-3 w-[48.5%] rounded-2xl border border-line bg-surface p-4 active:opacity-80"
              >
                <View className="flex-row items-start justify-between">
                  <Text className="text-3xl">{item.emoji}</Text>
                  {inCart > 0 ? (
                    <View className="h-6 min-w-6 items-center justify-center rounded-full bg-brand-500 px-1.5">
                      <Text className="text-xs font-bold text-black">{inCart}</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="mt-2 text-base font-semibold text-white" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="mt-0.5 text-sm font-bold text-brand-300">{money(item.price)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Cart bottom sheet / bar */}
      {count > 0 ? (
        <View className="absolute inset-x-4 bottom-4">
          {cartOpen ? (
            <Card className="mb-2 max-h-80">
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-base font-bold text-white">Order</Text>
                <Pressable onPress={() => setCartOpen(false)}>
                  <Ionicons name="chevron-down" size={22} color={colors.zinc400} />
                </Pressable>
              </View>
              <ScrollView className="max-h-52">
                {lines.map((l) => (
                  <View key={l.rec.id} className="flex-row items-center gap-3 py-2">
                    <Text className="text-xl">{l.rec.emoji}</Text>
                    <Text className="flex-1 text-white" numberOfLines={1}>
                      {l.rec.name}
                    </Text>
                    <Pressable onPress={() => remove(l.rec)} className="p-1">
                      <Ionicons name="remove-circle-outline" size={22} color={colors.rose} />
                    </Pressable>
                    <Text className="w-6 text-center font-bold text-white">{l.qty}</Text>
                    <Pressable onPress={() => add(l.rec)} className="p-1">
                      <Ionicons name="add-circle-outline" size={22} color={colors.brand400} />
                    </Pressable>
                    <Text className="w-16 text-right font-semibold text-zinc-300">
                      {money(l.rec.price * l.qty)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </Card>
          ) : null}

          <Pressable onPress={() => setCartOpen((o) => !o)}>
            <View className="flex-row items-center justify-between rounded-2xl bg-raised px-4 py-3">
              <View className="flex-row items-center gap-2">
                <View className="h-7 min-w-7 items-center justify-center rounded-full bg-brand-500 px-2">
                  <Text className="text-sm font-bold text-black">{count}</Text>
                </View>
                <Text className="font-semibold text-white">{money(subtotal)}</Text>
                <Muted>+ tax</Muted>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-zinc-400">
                  {cartOpen ? "Hide" : "View"}
                </Text>
                <Ionicons name="receipt-outline" size={18} color={colors.zinc400} />
              </View>
            </View>
          </Pressable>

          <Button
            title="Send to kitchen"
            className="mt-2"
            loading={createOrder.isPending}
            onPress={send}
          />
        </View>
      ) : null}
    </Screen>
  );
}
