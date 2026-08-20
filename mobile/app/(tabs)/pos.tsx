import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Screen,
  Card,
  Button,
  Badge,
  Muted,
  Divider,
  Input,
  Picker,
  type PickerOption,
} from "@/components/ui";
import {
  useMenu,
  useEventMenus,
  useCheckout,
  useSettle,
  useOpenOrders,
  useCustomers,
  useTables,
} from "@/lib/hooks";
import { useOrg } from "@/lib/org-context";
import { money } from "@/lib/format";
import { colors } from "@/lib/theme";
import type { Recipe, OrderLine, OrderType, PaymentMethod, Order } from "@/lib/types";
import { setKitchenStatus, type PaymentInput } from "@/lib/api/orders";
import { emailReceipt } from "@/lib/api/receipts";
import { printReceipt, isPrinterReady } from "@/lib/api/printing";

const TIP_OPTIONS = [0, 10, 15, 18, 20] as const;
const METHODS: { key: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "card", label: "Card", icon: "card" },
  { key: "cash", label: "Cash", icon: "cash" },
  { key: "wallet", label: "Wallet", icon: "wallet" },
];
const ORDER_TYPES: { key: OrderType; label: string }[] = [
  { key: "dine_in", label: "Dine-in" },
  { key: "takeaway", label: "Takeaway" },
  { key: "delivery", label: "Delivery" },
];

type BillLine = { name: string; qty: number; price: number };

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
}

// ---------------------------------------------------------------------------
// Pay / split modal — single payer, even split, or split by dish; each payer
// can use a different method. Returns payments[] + the resolved tip.
// ---------------------------------------------------------------------------
function PayModal({
  open,
  onClose,
  lines,
  subtotal,
  taxRate,
  initialTipPct,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  lines: BillLine[];
  subtotal: number;
  taxRate: number;
  initialTipPct: number;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (payments: PaymentInput[], tip: number) => void;
}) {
  const [tipPct, setTipPct] = useState(initialTipPct);
  const [mode, setMode] = useState<"single" | "even" | "item">("single");
  const [guests, setGuests] = useState(2);
  const [assign, setAssign] = useState<Record<number, number | "shared">>({});
  const [methods, setMethods] = useState<PaymentMethod[]>(Array(8).fill("card"));

  const tax = +(subtotal * (taxRate / 100)).toFixed(2);
  const tip = +(subtotal * (tipPct / 100)).toFixed(2);
  const total = +(subtotal + tax + tip).toFixed(2);
  const setMethod = (i: number, m: PaymentMethod) =>
    setMethods((prev) => prev.map((x, idx) => (idx === i ? m : x)));

  const payers = useMemo(() => {
    if (mode === "single")
      return [{ label: null as string | null, sub: subtotal, tax, tip, amount: total }];
    const n = guests;
    const subs = Array(n).fill(0) as number[];
    lines.forEach((l, i) => {
      const lineTotal = l.price * l.qty;
      const a = mode === "even" ? "shared" : assign[i] ?? "shared";
      if (a === "shared") for (let g = 0; g < n; g++) subs[g] += lineTotal / n;
      else subs[Math.min(a, n - 1)] += lineTotal;
    });
    const rows = subs.map((s) => {
      const ratio = subtotal > 0 ? s / subtotal : 1 / n;
      return {
        sub: +s.toFixed(2),
        tax: +(tax * ratio).toFixed(2),
        tip: +(tip * ratio).toFixed(2),
        amount: +(s + tax * ratio + tip * ratio).toFixed(2),
      };
    });
    const drift = +(total - rows.reduce((acc, r) => acc + r.amount, 0)).toFixed(2);
    if (rows[0]) rows[0].amount = +(rows[0].amount + drift).toFixed(2);
    return rows.map((r, i) => ({ label: `Guest ${i + 1}`, ...r }));
  }, [mode, guests, assign, lines, subtotal, tax, tip, total]);

  const confirm = () => {
    const payments: PaymentInput[] = payers.map((p, i) => ({
      method: mode === "single" ? methods[0] : methods[i],
      amount: p.amount,
      tip_amount: p.tip,
      split_label: p.label ?? undefined,
    }));
    onConfirm(payments, tip);
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="max-h-[90%] rounded-t-3xl border-t border-line bg-surface">
          <View className="flex-row items-center justify-between p-5 pb-2">
            <Text className="text-lg font-bold text-white">Take payment</Text>
            <Pressable onPress={onClose} className="p-1">
              <Ionicons name="close" size={24} color={colors.zinc400} />
            </Pressable>
          </View>

          <ScrollView className="px-5" contentContainerClassName="pb-4 gap-5">
            {/* Tip */}
            <View>
              <Muted className="mb-2">Tip</Muted>
              <View className="flex-row gap-1.5">
                {TIP_OPTIONS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => setTipPct(p)}
                    className={`flex-1 items-center rounded-lg border py-2.5 ${
                      tipPct === p ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${tipPct === p ? "text-brand-300" : "text-zinc-300"}`}
                    >
                      {p === 0 ? "None" : `${p}%`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Split mode */}
            <View>
              <Muted className="mb-2">How are they paying?</Muted>
              <View className="flex-row rounded-xl border border-line bg-white/5 p-1">
                {(
                  [
                    ["single", "One payment"],
                    ["even", "Split evenly"],
                    ["item", "By dish"],
                  ] as ["single" | "even" | "item", string][]
                ).map(([m, label]) => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    className={`flex-1 items-center rounded-lg py-2 ${mode === m ? "bg-white/10" : ""}`}
                  >
                    <Text
                      className={`text-xs font-semibold ${mode === m ? "text-white" : "text-zinc-500"}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {mode !== "single" ? (
              <View>
                <Muted className="mb-2">Number of guests</Muted>
                <View className="flex-row gap-1.5">
                  {[2, 3, 4, 5, 6].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => setGuests(n)}
                      className={`flex-1 items-center rounded-lg border py-2.5 ${
                        guests === n ? "border-accent-400 bg-accent-400/15" : "border-line bg-white/5"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${guests === n ? "text-accent-400" : "text-zinc-300"}`}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Assign dishes */}
            {mode === "item" ? (
              <View className="gap-2">
                <Muted>Assign each dish</Muted>
                {lines.map((l, i) => (
                  <View key={i} className="rounded-xl border border-line bg-white/5 p-2.5">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-white">
                        {l.qty}× {l.name}
                      </Text>
                      <Text className="text-sm text-zinc-400">{money(l.price * l.qty)}</Text>
                    </View>
                    <View className="mt-2 flex-row flex-wrap gap-1">
                      {Array.from({ length: guests }, (_, g) => (
                        <Pressable
                          key={g}
                          onPress={() => setAssign((p) => ({ ...p, [i]: g }))}
                          className={`rounded-lg border px-2.5 py-1 ${
                            (assign[i] ?? "shared") === g
                              ? "border-brand-500 bg-brand-500/15"
                              : "border-line"
                          }`}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              (assign[i] ?? "shared") === g ? "text-brand-300" : "text-zinc-400"
                            }`}
                          >
                            G{g + 1}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        onPress={() => setAssign((p) => ({ ...p, [i]: "shared" }))}
                        className={`rounded-lg border px-2.5 py-1 ${
                          (assign[i] ?? "shared") === "shared"
                            ? "border-accent-400 bg-accent-400/15"
                            : "border-line"
                        }`}
                      >
                        <Text
                          className={`text-xs font-semibold ${
                            (assign[i] ?? "shared") === "shared" ? "text-accent-400" : "text-zinc-400"
                          }`}
                        >
                          Shared
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Per-payer amount + method */}
            <View className="gap-2 rounded-xl border border-line bg-white/5 p-3">
              {payers.map((p, i) => (
                <View key={i} className="gap-2 border-b border-line pb-2 last:border-0 last:pb-0">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-semibold text-white">{p.label ?? "Total due"}</Text>
                    <Text className="text-sm text-zinc-400">{money(p.amount)}</Text>
                  </View>
                  <View className="flex-row gap-1">
                    {METHODS.map((m) => {
                      const sel = (mode === "single" ? methods[0] : methods[i]) === m.key;
                      return (
                        <Pressable
                          key={m.key}
                          onPress={() => setMethod(mode === "single" ? 0 : i, m.key)}
                          className={`flex-1 flex-row items-center justify-center gap-1 rounded-lg border py-1.5 ${
                            sel ? "border-brand-500 bg-brand-500/15" : "border-line"
                          }`}
                        >
                          <Ionicons
                            name={m.icon}
                            size={14}
                            color={sel ? colors.brand400 : colors.zinc400}
                          />
                          <Text
                            className={`text-xs font-medium ${sel ? "text-brand-300" : "text-zinc-400"}`}
                          >
                            {m.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>

            {/* Totals */}
            <View className="gap-1">
              <View className="flex-row justify-between">
                <Muted>Subtotal</Muted>
                <Text className="text-zinc-300">{money(subtotal)}</Text>
              </View>
              <View className="flex-row justify-between">
                <Muted>Incl. tax ({taxRate}%)</Muted>
                <Text className="text-zinc-300">{money(tax)}</Text>
              </View>
              {tip > 0 ? (
                <View className="flex-row justify-between">
                  <Muted>Tip ({tipPct}%)</Muted>
                  <Text className="text-zinc-300">{money(tip)}</Text>
                </View>
              ) : null}
              <Divider />
              <View className="flex-row justify-between pt-1">
                <Text className="text-base font-bold text-white">Total</Text>
                <Text className="text-base font-bold text-brand-300">{money(total)}</Text>
              </View>
            </View>
          </ScrollView>

          <View className="flex-row gap-2 border-t border-line p-5 pt-3">
            <Button title="Cancel" variant="ghost" className="flex-1" onPress={onClose} disabled={pending} />
            <Button title={confirmLabel} className="flex-[2]" onPress={confirm} loading={pending} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function Pos() {
  const menuQ = useMenu();
  const eventMenusQ = useEventMenus();
  const ordersQ = useOpenOrders();
  const customersQ = useCustomers();
  const tablesQ = useTables();
  const checkout = useCheckout();
  const settle = useSettle();
  const { ctx } = useOrg();
  const taxRate = ctx?.org.tax_rate ?? 8.5;
  const menu = menuQ.data ?? [];

  const [view, setView] = useState<"order" | "tabs">("order");
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("All");
  const [eventMenuId, setEventMenuId] = useState<string>(""); // "" = full menu
  const [cart, setCart] = useState<Record<string, { rec: Recipe; qty: number }>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [tableId, setTableId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [kitchenNotes, setKitchenNotes] = useState("");
  const [address, setAddress] = useState("");
  const [tipPct, setTipPct] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [payOpen, setPayOpen] = useState(false);
  const [settling, setSettling] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<{
    order_id: string;
    order_number: string;
    total: number;
    lines: BillLine[];
    tax: number;
    tip: number;
    method: string;
    sentToKitchen: boolean;
  } | null>(null);
  const [belegEmail, setBelegEmail] = useState("");
  const [belegSending, setBelegSending] = useState(false);
  const [belegNote, setBelegNote] = useState("");
  const [printing, setPrinting] = useState(false);

  // Event/popup menus: when one is picked, the grid shows only its dishes.
  const eventMenus = eventMenusQ.data ?? [];
  const eventMenuIds = useMemo(() => {
    const m = eventMenus.find((x) => x.id === eventMenuId);
    return m ? new Set(m.recipe_ids) : null;
  }, [eventMenus, eventMenuId]);

  // Every dish that belongs to some event/popup menu — excluded from the
  // default "Restaurant Menu" view so event-only items don't bleed into
  // regular service.
  const eventRecipeIds = useMemo(
    () => new Set(eventMenus.flatMap((m) => m.recipe_ids)),
    [eventMenus],
  );

  // Pre-prepared event menu → orders skip the Kitchen board entirely.
  const skipKitchen = !!eventMenus.find((x) => x.id === eventMenuId)?.skip_kitchen;

  // eventMenuId === "" is the default "Restaurant Menu": every dish except
  // ones that only belong to an event menu. Picking an event menu narrows
  // the grid to just that menu's dishes.
  const inMenu = useMemo(
    () => (eventMenuIds ? menu.filter((m) => eventMenuIds.has(m.id)) : menu.filter((m) => !eventRecipeIds.has(m.id))),
    [menu, eventMenuIds, eventRecipeIds],
  );

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(inMenu.map((m) => m.category)))],
    [inMenu],
  );
  // Switching menus can strand a category that no longer exists — fall back to
  // "All" so the grid never silently renders empty.
  const effectiveCat = categories.includes(cat) ? cat : "All";
  const visible = inMenu.filter(
    (m) =>
      (effectiveCat === "All" || m.category === effectiveCat) &&
      m.name.toLowerCase().includes(query.toLowerCase()),
  );

  const lines = Object.values(cart);
  const billLines: BillLine[] = lines.map((l) => ({ name: l.rec.name, qty: l.qty, price: l.rec.price }));
  const count = lines.reduce((s, l) => s + l.qty, 0);
  // VAT-included (gross) pricing, mirroring checkout_order (migration 0017):
  // menu prices already contain VAT, so break it out rather than adding on top.
  // `subtotal` is NET — which is what PayModal expects, since net × rate/100
  // equals the VAT contained in the gross price.
  const gross = lines.reduce((s, l) => s + l.rec.price * l.qty, 0);
  const tax = +(gross * (taxRate / (100 + taxRate))).toFixed(2);
  const subtotal = +(gross - tax).toFixed(2);
  const tip = +(gross * (tipPct / 100)).toFixed(2);
  const total = +(gross + tip).toFixed(2);

  const openTabs = useMemo(
    () => (ordersQ.data ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [ordersQ.data],
  );
  const tableName = (id: string | null) =>
    id ? (tablesQ.data ?? []).find((t) => t.id === id)?.name ?? null : null;

  const add = (rec: Recipe) =>
    setCart((c) => ({ ...c, [rec.id]: { rec, qty: (c[rec.id]?.qty ?? 0) + 1 } }));
  const dec = (rec: Recipe) =>
    setCart((c) => {
      const qty = (c[rec.id]?.qty ?? 0) - 1;
      const next = { ...c };
      if (qty <= 0) delete next[rec.id];
      else next[rec.id] = { rec, qty };
      return next;
    });

  const reset = () => {
    setCart({});
    setCartOpen(false);
    setTipPct(0);
    setKitchenNotes("");
    setCustomerId("");
    setTableId("");
    setAddress("");
    setOrderType("dine_in");
  };

  const orderLines = (): OrderLine[] =>
    lines.map((l) => ({ recipe_id: l.rec.id, name: l.rec.name, qty: l.qty, price: l.rec.price }));

  const payload = (payments: PaymentInput[], tipAmount: number) => ({
    items: orderLines(),
    orderType,
    tableId: orderType === "dine_in" && tableId ? tableId : null,
    customerId: customerId || null,
    kitchenNotes: kitchenNotes || null,
    tip: tipAmount,
    address: orderType === "delivery" ? address : null,
    payments,
  });

  const finishCheckout = (payments: PaymentInput[], tipAmount: number) => {
    const snapshot = billLines;
    const snapTax = tax;
    checkout.mutate(payload(payments, tipAmount), {
      onSuccess: (res) => {
        const paid = payments.length > 0;
        // Pre-prepared event menu: hand-over is immediate, so don't queue a
        // ticket on the Kitchen board. Non-fatal — the sale is already recorded.
        if (skipKitchen && res.order_id && ctx?.org.id) {
          setKitchenStatus(ctx.org.id, res.order_id, "served").catch(() => {});
        }
        reset();
        setPayOpen(false);
        if (paid) {
          setBelegEmail("");
          setBelegNote("");
          setReceipt({
            order_id: res.order_id,
            order_number: res.order_number,
            total: res.total,
            lines: snapshot,
            tax: snapTax,
            tip: tipAmount,
            method: payments.length > 1 ? "split" : payments[0].method,
            sentToKitchen: !skipKitchen,
          });
        } else {
          setView("tabs");
        }
      },
    });
  };

  return (
    <Screen>
      {/* New order / Open tabs toggle */}
      <View className="flex-row rounded-xl border border-line bg-white/5 p-1 my-3">
        <Pressable
          onPress={() => setView("order")}
          className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${
            view === "order" ? "bg-white/10" : ""
          }`}
        >
          <Ionicons name="bag-add" size={15} color={view === "order" ? colors.white : colors.zinc500} />
          <Text className={`text-sm font-semibold ${view === "order" ? "text-white" : "text-zinc-500"}`}>
            New order
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setView("tabs")}
          className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2 ${
            view === "tabs" ? "bg-white/10" : ""
          }`}
        >
          <Ionicons name="receipt" size={15} color={view === "tabs" ? colors.white : colors.zinc500} />
          <Text className={`text-sm font-semibold ${view === "tabs" ? "text-white" : "text-zinc-500"}`}>
            Open tabs
          </Text>
          {openTabs.length > 0 ? (
            <View className="rounded-full bg-accent-400/20 px-1.5">
              <Text className="text-[10px] font-bold text-accent-400">{openTabs.length}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {view === "tabs" ? (
        <OpenTabs tabs={openTabs} tableName={tableName} onSettle={setSettling} />
      ) : (
        <>
          {/* Search */}
          <View className="relative mb-3">
            <View className="absolute left-3.5 top-3 z-10">
              <Ionicons name="search" size={18} color={colors.zinc500} />
            </View>
            <Input
              placeholder="Search menu…"
              value={query}
              onChangeText={setQuery}
              className="pl-10"
            />
          </View>

          {/* Event/popup menu switcher — only when the org has active event menus */}
          {eventMenus.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-none"
              contentContainerClassName="gap-2 pb-3"
            >
              <Pressable
                onPress={() => setEventMenuId("")}
                className={`self-start rounded-lg border px-3.5 py-2 ${
                  eventMenuId === "" ? "border-accent-400 bg-accent-400" : "border-line bg-white/5"
                }`}
              >
                <Text
                  className={`text-xs font-bold ${eventMenuId === "" ? "text-black" : "text-zinc-300"}`}
                >
                  Restaurant Menu
                </Text>
              </Pressable>
              {eventMenus.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setEventMenuId(m.id)}
                  className={`self-start rounded-lg border px-3.5 py-2 ${
                    eventMenuId === m.id ? "border-accent-400 bg-accent-400" : "border-line bg-white/5"
                  }`}
                >
                  <Text
                    className={`text-xs font-bold ${eventMenuId === m.id ? "text-black" : "text-zinc-300"}`}
                  >
                    {m.name} · {m.recipe_ids.length}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* Category pills — flex-none so it can't stretch to fill the column's remaining height */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-none"
            contentContainerClassName="gap-2 pb-3"
          >
            {categories.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCat(c)}
                className={`self-start rounded-full border px-4 py-2 ${
                  effectiveCat === c ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${effectiveCat === c ? "text-black" : "text-zinc-300"}`}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Product grid — flex-1 so it deterministically owns the remaining space */}
          <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="pb-28">
            {menuQ.isLoading ? (
              <Card>
                <View className="flex-row items-center justify-center gap-2 py-8">
                  <ActivityIndicator color={colors.zinc400} />
                  <Muted>Loading menu…</Muted>
                </View>
              </Card>
            ) : menuQ.isError ? (
              <Card>
                <Muted className="pt-8 text-center">Couldn’t load the menu.</Muted>
                <Pressable onPress={() => menuQ.refetch()} className="mx-auto mt-3 mb-8 rounded-lg border border-line bg-white/5 px-4 py-2">
                  <Text className="text-sm font-semibold text-zinc-200">Tap to retry</Text>
                </Pressable>
              </Card>
            ) : visible.length === 0 ? (
              <Card>
                <Muted className="py-8 text-center">
                  {menu.length === 0 ? "No menu items yet." : `No items match “${query}”.`}
                </Muted>
              </Card>
            ) : (
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
                      <View className="mt-0.5 flex-row items-center justify-between">
                        <Text className="text-xs text-zinc-500">{item.category}</Text>
                        <Text className="text-sm font-bold text-brand-300">{money(item.price)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>

          {/* Collapsed cart bar */}
          {count > 0 && !cartOpen ? (
            <Pressable className="absolute inset-x-4 bottom-4" onPress={() => setCartOpen(true)}>
              <View className="flex-row items-center justify-between rounded-2xl bg-raised px-4 py-3.5">
                <View className="flex-row items-center gap-2">
                  <View className="h-7 min-w-7 items-center justify-center rounded-full bg-brand-500 px-2">
                    <Text className="text-sm font-bold text-black">{count}</Text>
                  </View>
                  <Text className="font-semibold text-white">View order</Text>
                </View>
                <Text className="font-bold text-brand-300">{money(total)}</Text>
              </View>
            </Pressable>
          ) : null}
        </>
      )}

      {/* Cart sheet — the full order form */}
      <Modal visible={cartOpen} transparent animationType="slide" onRequestClose={() => setCartOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="max-h-[92%] rounded-t-3xl border-t border-line bg-surface">
            <View className="flex-row items-center justify-between p-5 pb-2">
              <Text className="text-lg font-bold text-white">Current order</Text>
              <View className="flex-row items-center gap-3">
                {count > 0 ? (
                  <Pressable onPress={reset}>
                    <Text className="text-xs text-zinc-500">Clear</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setCartOpen(false)} className="p-1">
                  <Ionicons name="chevron-down" size={24} color={colors.zinc400} />
                </Pressable>
              </View>
            </View>

            <ScrollView className="px-5" contentContainerClassName="pb-4 gap-3">
              {/* Order type */}
              <View className="flex-row rounded-xl border border-line bg-white/5 p-1">
                {ORDER_TYPES.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => setOrderType(t.key)}
                    className={`flex-1 items-center rounded-lg py-2 ${orderType === t.key ? "bg-white/10" : ""}`}
                  >
                    <Text
                      className={`text-xs font-semibold ${orderType === t.key ? "text-white" : "text-zinc-500"}`}
                    >
                      {t.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Line items */}
              {lines.length === 0 ? (
                <Muted className="py-8 text-center">Tap items to start an order.</Muted>
              ) : (
                lines.map((l) => (
                  <View
                    key={l.rec.id}
                    className="flex-row items-center gap-3 rounded-xl border border-line bg-white/5 p-2.5"
                  >
                    <Text className="text-xl">{l.rec.emoji}</Text>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-white" numberOfLines={1}>
                        {l.rec.name}
                      </Text>
                      <Text className="text-xs text-zinc-500">{money(l.rec.price)} each</Text>
                    </View>
                    <Pressable onPress={() => dec(l.rec)} className="p-1">
                      <Ionicons
                        name={l.qty === 1 ? "trash-outline" : "remove-circle-outline"}
                        size={22}
                        color={colors.rose}
                      />
                    </Pressable>
                    <Text className="w-6 text-center font-bold text-white">{l.qty}</Text>
                    <Pressable onPress={() => add(l.rec)} className="p-1">
                      <Ionicons name="add-circle-outline" size={22} color={colors.brand400} />
                    </Pressable>
                  </View>
                ))
              )}

              {lines.length > 0 ? (
                <>
                  {/* Table / customer / notes / address */}
                  {orderType === "dine_in" && (tablesQ.data ?? []).length > 0 ? (
                    <Picker
                      title="Table"
                      value={tableId}
                      onChange={setTableId}
                      placeholder="No table"
                      options={[
                        { label: "No table", value: "" },
                        ...(tablesQ.data ?? [])
                          .filter((t) => t.status === "open" || t.id === tableId)
                          .map<PickerOption>((t) => ({
                            label: `Table ${t.name} · ${t.seats} seats · ${t.zone}`,
                            value: t.id,
                          })),
                      ]}
                    />
                  ) : null}

                  <Picker
                    title="Customer"
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="Walk-in guest"
                    options={[
                      { label: "Walk-in guest", value: "" },
                      ...(customersQ.data ?? []).map<PickerOption>((c) => ({
                        label: `${c.name} · ${c.tier}`,
                        value: c.id,
                      })),
                    ]}
                  />

                  <Input
                    placeholder="Kitchen note (allergies, mods…)"
                    value={kitchenNotes}
                    onChangeText={setKitchenNotes}
                  />
                  {orderType === "delivery" ? (
                    <Input
                      placeholder="Delivery address"
                      value={address}
                      onChangeText={setAddress}
                    />
                  ) : null}

                  {/* Tip */}
                  <Muted className="mt-1">Tip</Muted>
                  <View className="flex-row gap-1.5">
                    {[0, 10, 15, 20].map((p) => (
                      <Pressable
                        key={p}
                        onPress={() => setTipPct(p)}
                        className={`flex-1 items-center rounded-lg border py-2 ${
                          tipPct === p ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold ${tipPct === p ? "text-brand-300" : "text-zinc-300"}`}
                        >
                          {p === 0 ? "No tip" : `${p}%`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {/* Totals */}
                  <View className="mt-2 gap-1 border-t border-line pt-3">
                    <View className="flex-row justify-between">
                      <Muted>Subtotal</Muted>
                      <Text className="text-zinc-300">{money(subtotal)}</Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Muted>Incl. tax ({taxRate}%)</Muted>
                      <Text className="text-zinc-300">{money(tax)}</Text>
                    </View>
                    {tip > 0 ? (
                      <View className="flex-row justify-between">
                        <Muted>Tip ({tipPct}%)</Muted>
                        <Text className="text-zinc-300">{money(tip)}</Text>
                      </View>
                    ) : null}
                    <View className="flex-row justify-between pt-0.5">
                      <Text className="text-base font-bold text-white">Total</Text>
                      <Text className="text-base font-bold text-brand-300">{money(total)}</Text>
                    </View>
                  </View>

                  {/* Quick payment method */}
                  <View className="mt-1 flex-row gap-2">
                    {METHODS.map((m) => {
                      const sel = method === m.key;
                      return (
                        <Pressable
                          key={m.key}
                          onPress={() => setMethod(m.key)}
                          className={`flex-1 items-center gap-1 rounded-xl border py-2.5 ${
                            sel ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
                          }`}
                        >
                          <Ionicons name={m.icon} size={20} color={sel ? colors.brand400 : colors.zinc400} />
                          <Text
                            className={`text-xs font-semibold ${sel ? "text-brand-300" : "text-zinc-300"}`}
                          >
                            {m.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </ScrollView>

            {/* Actions */}
            {lines.length > 0 ? (
              <View className="gap-2 border-t border-line p-5 pt-3">
                {orderType === "dine_in" ? (
                  <Button
                    title="Send to kitchen · pay later"
                    variant="ghost"
                    loading={checkout.isPending}
                    onPress={() => finishCheckout([], 0)}
                  />
                ) : null}
                <View className="flex-row gap-2">
                  <Button
                    title={`Charge ${money(total)}`}
                    className="flex-[2]"
                    loading={checkout.isPending}
                    onPress={() =>
                      finishCheckout([{ method, amount: total, tip_amount: tip }], tip)
                    }
                  />
                  <Button
                    title="Split"
                    variant="ghost"
                    className="flex-1"
                    onPress={() => {
                      setCartOpen(false);
                      setPayOpen(true);
                    }}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Split / pay modal for the cart */}
      <PayModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        lines={billLines}
        subtotal={subtotal}
        taxRate={taxRate}
        initialTipPct={tipPct}
        confirmLabel={`Charge ${money(total)}`}
        pending={checkout.isPending}
        onConfirm={(payments, t) => finishCheckout(payments, t)}
      />

      {/* Settle an open tab */}
      {settling ? (
        <PayModal
          open={!!settling}
          onClose={() => setSettling(null)}
          lines={settling.items as BillLine[]}
          subtotal={settling.subtotal}
          taxRate={taxRate}
          initialTipPct={0}
          confirmLabel={`Settle ${settling.order_number}`}
          pending={settle.isPending}
          onConfirm={(payments, t) =>
            settle.mutate(
              { orderId: settling.id, payments, tip: t },
              { onSuccess: () => setSettling(null) },
            )
          }
        />
      ) : null}

      {/* Receipt */}
      <Modal visible={!!receipt} transparent animationType="fade" onRequestClose={() => setReceipt(null)}>
        <View className="flex-1 items-center justify-center bg-black/70 p-6">
          {receipt ? (
            <Card className="w-full">
              <View className="items-center gap-1 py-2">
                <Ionicons name="checkmark-circle" size={56} color={colors.brand400} />
                <Text className="text-3xl font-bold text-white">{money(receipt.total)}</Text>
                <Badge tone="green">Paid · {receipt.method}</Badge>
                <Muted>
                  {receipt.order_number}
                  {receipt.sentToKitchen ? " · sent to kitchen" : " · ready to serve"}
                </Muted>
              </View>
              <View className="mt-3 gap-1.5 rounded-xl border border-line bg-white/5 p-4">
                {receipt.lines.map((l) => (
                  <View key={l.name} className="flex-row justify-between">
                    <Text className="text-zinc-300">
                      {l.qty}× {l.name}
                    </Text>
                    <Text className="text-zinc-300">{money(l.price * l.qty)}</Text>
                  </View>
                ))}
                <View className="mt-1 flex-row justify-between border-t border-line pt-2">
                  <Muted>Incl. tax ({taxRate}%)</Muted>
                  <Text className="text-zinc-400">{money(receipt.tax)}</Text>
                </View>
                {receipt.tip > 0 ? (
                  <View className="flex-row justify-between">
                    <Muted>Tip</Muted>
                    <Text className="text-zinc-400">{money(receipt.tip)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Direct print — straight to the thermal printer on the LAN, no
                  dialog. Only shown once a printer is configured for the org. */}
              {ctx?.org && isPrinterReady(ctx.org) ? (
                <Pressable
                  disabled={printing}
                  onPress={async () => {
                    setPrinting(true);
                    setBelegNote("");
                    const r = await printReceipt(receipt.order_id, ctx.org);
                    setBelegNote(r.message);
                    setPrinting(false);
                  }}
                  className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl py-3.5 ${
                    printing ? "bg-white/10" : "bg-white/10 active:bg-white/20"
                  }`}
                >
                  <Ionicons name="print" size={17} color={printing ? colors.zinc500 : colors.white} />
                  <Text className={`text-sm font-bold ${printing ? "text-zinc-500" : "text-white"}`}>
                    {printing ? "Drucken…" : "Bon drucken"}
                  </Text>
                </Pressable>
              ) : null}

              {/* Beleg — email a German receipt if the guest asks for one */}
              <View className="mt-3 gap-2">
                <Muted>Beleg per E-Mail (optional)</Muted>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Input
                      placeholder="gast@example.com"
                      value={belegEmail}
                      onChangeText={setBelegEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                  <Pressable
                    disabled={belegSending || !belegEmail.trim()}
                    onPress={async () => {
                      setBelegSending(true);
                      setBelegNote("");
                      const r = await emailReceipt(receipt.order_id, belegEmail);
                      setBelegNote(r.message);
                      setBelegSending(false);
                    }}
                    className={`items-center justify-center rounded-xl px-4 ${
                      belegSending || !belegEmail.trim() ? "bg-white/10" : "bg-brand-500"
                    }`}
                  >
                    <Text className={`text-sm font-bold ${belegSending || !belegEmail.trim() ? "text-zinc-500" : "text-black"}`}>
                      {belegSending ? "…" : "Senden"}
                    </Text>
                  </Pressable>
                </View>
                {belegNote ? <Muted>{belegNote}</Muted> : null}
              </View>

              <Button title="New order" className="mt-4" onPress={() => setReceipt(null)} />
            </Card>
          ) : null}
        </View>
      </Modal>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Open tabs — dine-in orders sent to the kitchen but not yet paid.
// ---------------------------------------------------------------------------
function OpenTabs({
  tabs,
  tableName,
  onSettle,
}: {
  tabs: Order[];
  tableName: (id: string | null) => string | null;
  onSettle: (o: Order) => void;
}) {
  const kitchenTone: Record<string, "neutral" | "amber" | "green" | "accent"> = {
    new: "neutral",
    preparing: "amber",
    ready: "accent",
    served: "green",
  };

  if (tabs.length === 0) {
    return (
      <Card>
        <Muted className="py-10 text-center">
          No open tabs. Dine-in orders you send to the kitchen without paying show up here to settle
          later.
        </Muted>
      </Card>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-3 pb-6">
      {tabs.map((o) => {
        const tn = tableName(o.table_id);
        const items = o.items as BillLine[];
        return (
          <Card key={o.id}>
            <View className="flex-row items-start justify-between">
              <View>
                <Text className="font-semibold text-white">
                  {tn ? `Table ${tn}` : o.guest_name || "Walk-in"}
                </Text>
                <Muted>{o.order_number}</Muted>
              </View>
              <Badge tone={kitchenTone[o.kitchen_status] ?? "neutral"}>{o.kitchen_status}</Badge>
            </View>

            <View className="mt-3 gap-1">
              {items.slice(0, 4).map((l, i) => (
                <View key={i} className="flex-row justify-between">
                  <Text className="text-sm text-zinc-400" numberOfLines={1}>
                    {l.qty}× {l.name}
                  </Text>
                  <Text className="text-sm text-zinc-400">{money(l.price * l.qty)}</Text>
                </View>
              ))}
              {items.length > 4 ? (
                <Text className="text-xs text-zinc-600">+{items.length - 4} more…</Text>
              ) : null}
            </View>

            <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
              <Muted>{timeAgo(o.created_at)}</Muted>
              <Text className="text-base font-bold text-white">{money(o.total)}</Text>
            </View>

            <Button title="Settle bill" className="mt-3" onPress={() => onSettle(o)} />
          </Card>
        );
      })}
    </ScrollView>
  );
}
