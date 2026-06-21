import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Muted, Divider } from "@/components/ui";
import { useMenu, useCreateOrder } from "@/lib/hooks";
import { useOrg } from "@/lib/org-context";
import { money } from "@/lib/format";
import { colors } from "@/lib/theme";
import type { Recipe, OrderLine, PaymentMethod } from "@/lib/types";

const TIP_OPTIONS = [0, 10, 15, 20] as const;
const METHODS: { key: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "card", label: "Card", icon: "card" },
  { key: "cash", label: "Cash", icon: "cash" },
  { key: "wallet", label: "Wallet", icon: "wallet" },
];

export default function Pos() {
  const menuQ = useMenu();
  const createOrder = useCreateOrder();
  const { ctx } = useOrg();
  const taxRate = ctx?.org.tax_rate ?? 0;
  const menu = menuQ.data ?? [];

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((m) => m.category)))],
    [menu],
  );
  const [cat, setCat] = useState("All");
  const [cart, setCart] = useState<Record<string, { rec: Recipe; qty: number }>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tipPct, setTipPct] = useState<number>(0);
  const [method, setMethod] = useState<PaymentMethod>("card");

  const visible = cat === "All" ? menu : menu.filter((m) => m.category === cat);
  const lines = Object.values(cart);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.rec.price * l.qty, 0);
  const tax = +(subtotal * (taxRate / 100)).toFixed(2);
  const tip = +(subtotal * (tipPct / 100)).toFixed(2);
  const total = +(subtotal + tax + tip).toFixed(2);

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

  const orderLines = (): OrderLine[] =>
    lines.map((l) => ({ recipe_id: l.rec.id, name: l.rec.name, qty: l.qty, price: l.rec.price }));

  const reset = () => {
    setCart({});
    setCartOpen(false);
    setCheckoutOpen(false);
    setTipPct(0);
  };

  // Fire to the kitchen without taking payment (dine-in: pay later).
  const sendToKitchen = () => {
    createOrder.mutate(
      { items: orderLines(), tip: 0, table_id: null },
      {
        onSuccess: (o) => {
          reset();
          Alert.alert("Sent to kitchen", `Order ${o.order_number} is firing. 🔥`);
        },
        onError: (e) => Alert.alert("Couldn’t send", String(e)),
      },
    );
  };

  // Take payment now → order is created already paid.
  const charge = () => {
    createOrder.mutate(
      { items: orderLines(), tip, table_id: null, payment_method: method },
      {
        onSuccess: (o) => {
          const label = METHODS.find((m) => m.key === method)?.label ?? "Card";
          reset();
          Alert.alert("Payment taken", `${money(total)} on ${label} · order ${o.order_number}.`);
        },
        onError: (e) => Alert.alert("Payment failed", String(e)),
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-44">
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

      {/* Cart bottom bar */}
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

          <View className="mt-2 flex-row gap-2">
            <Button
              title="Send to kitchen"
              variant="ghost"
              className="flex-1"
              loading={createOrder.isPending}
              onPress={sendToKitchen}
            />
            <Button
              title="Review & Pay"
              className="flex-1"
              onPress={() => setCheckoutOpen(true)}
            />
          </View>
        </View>
      ) : null}

      {/* Checkout / payment sheet */}
      <Modal
        visible={checkoutOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCheckoutOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="rounded-t-3xl border-t border-line bg-surface p-5 pb-8">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-white">Checkout</Text>
              <Pressable onPress={() => setCheckoutOpen(false)} className="p-1">
                <Ionicons name="close" size={24} color={colors.zinc400} />
              </Pressable>
            </View>

            {/* Summary */}
            <View className="gap-1.5">
              <View className="flex-row justify-between">
                <Muted>Subtotal ({count} item{count === 1 ? "" : "s"})</Muted>
                <Text className="text-zinc-200">{money(subtotal)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Muted>Tax ({taxRate}%)</Muted>
                <Text className="text-zinc-200">{money(tax)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Muted>Tip</Muted>
                <Text className="text-zinc-200">{money(tip)}</Text>
              </View>
              <Divider />
              <View className="flex-row justify-between pt-1">
                <Text className="text-base font-bold text-white">Total</Text>
                <Text className="text-base font-bold text-brand-300">{money(total)}</Text>
              </View>
            </View>

            {/* Tip */}
            <Text className="mb-2 mt-5 text-sm font-semibold text-zinc-300">Add a tip</Text>
            <View className="flex-row gap-2">
              {TIP_OPTIONS.map((pct) => (
                <Pressable
                  key={pct}
                  onPress={() => setTipPct(pct)}
                  className={`flex-1 items-center rounded-xl border py-3 ${
                    tipPct === pct ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
                  }`}
                >
                  <Text
                    className={`text-sm font-bold ${tipPct === pct ? "text-brand-300" : "text-zinc-300"}`}
                  >
                    {pct === 0 ? "No tip" : `${pct}%`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Payment method */}
            <Text className="mb-2 mt-5 text-sm font-semibold text-zinc-300">Payment method</Text>
            <View className="flex-row gap-2">
              {METHODS.map((m) => (
                <Pressable
                  key={m.key}
                  onPress={() => setMethod(m.key)}
                  className={`flex-1 items-center gap-1 rounded-xl border py-3 ${
                    method === m.key ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
                  }`}
                >
                  <Ionicons
                    name={m.icon}
                    size={22}
                    color={method === m.key ? colors.brand400 : colors.zinc400}
                  />
                  <Text
                    className={`text-sm font-semibold ${method === m.key ? "text-brand-300" : "text-zinc-300"}`}
                  >
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Button
              title={`Charge ${money(total)}`}
              className="mt-6"
              loading={createOrder.isPending}
              onPress={charge}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
