import { useMemo, useState } from "react";
import { Alert, ScrollView, View, Text, Pressable, Linking } from "react-native";
import { Screen, Card, Button, Badge, Muted, Divider, Picker } from "@/components/ui";
import { usePreorderEvents, usePreorderOrders, usePreorderMutations } from "@/lib/hooks";
import {
  computeDayTotals,
  computeHourCapacity,
  hoursWithRoom,
  unassignedParties,
  formatTime,
  minutesToTime,
  type HourSlot,
} from "@/lib/preorders";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { PreorderEvent, PreorderOrder } from "@/lib/types";

const FULFILMENT_LABEL = { dine_in: "Dine-in", takeaway: "Takeaway", delivery: "Delivery" } as const;
const SLOT_BAR: Record<HourSlot["state"], string> = {
  empty: "bg-zinc-600",
  ok: "bg-brand-400",
  near: "bg-amber-soft",
  full: "bg-rose-soft",
  over: "bg-rose-soft",
};

const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

const slotLabel = (o: PreorderOrder) =>
  !o.timeslot_start ? "—" : o.timeslot_end ? `${formatTime(o.timeslot_start)}–${formatTime(o.timeslot_end)}` : formatTime(o.timeslot_start);

function Stat({ label, value, hint, urgent }: { label: string; value: string; hint?: string; urgent?: boolean }) {
  return (
    <View className="min-w-[30%] flex-1 rounded-xl border border-line bg-white/[0.02] p-3">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</Text>
      <Text className={`mt-0.5 text-2xl font-bold ${urgent ? "text-rose-soft" : "text-white"}`}>{value}</Text>
      {hint ? <Text className="text-xs text-zinc-500">{hint}</Text> : null}
    </View>
  );
}

function QueueCard({
  event,
  queue,
  dayOrders,
}: {
  event: PreorderEvent;
  queue: PreorderOrder[];
  dayOrders: PreorderOrder[];
}) {
  const { seat } = usePreorderMutations();
  const covers = queue.reduce((n, o) => n + o.quantity, 0);
  return (
    <Card className="border-amber-soft/30">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-lg font-bold text-white">Needs a seating time</Text>
        <Badge tone="amber">{`${covers} covers`}</Badge>
      </View>
      <Muted>Pick a time to seat each party. Full seatings aren't offered.</Muted>
      <View className="mt-3 gap-3">
        {queue.map((o) => {
          const options = hoursWithRoom(event, dayOrders, o.quantity, o.id);
          return (
            <View key={o.id} className="gap-2 rounded-xl border border-line bg-white/[0.02] p-3">
              <View className="flex-row items-center gap-3">
                <View className="h-9 min-w-9 items-center justify-center rounded-lg bg-amber-soft/15 px-2">
                  <Text className="text-base font-bold text-amber-soft">{o.quantity}</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-white">{o.customer_name || "Unnamed"}</Text>
                  <Text className="text-xs text-zinc-500">
                    {[o.customer_phone, o.customer_email].filter(Boolean).join(" · ") || "No contact"}
                  </Text>
                </View>
              </View>
              {o.special_requests ? <Text className="text-xs text-violet-soft">{o.special_requests}</Text> : null}
              {options.length === 0 ? (
                <Badge tone="rose">{`No seating fits ${o.quantity}`}</Badge>
              ) : (
                <Picker
                  value=""
                  title={`Seat ${o.customer_name || "party"}`}
                  placeholder="Seat at…"
                  options={options.map((s) => ({
                    value: String(s.startMin),
                    label: `${formatTime(minutesToTime(s.startMin))} · ${s.remaining} left`,
                  }))}
                  onChange={(v) =>
                    v &&
                    seat.mutate(
                      { id: o.id, startMin: Number(v), slotMinutes: event.slot_minutes },
                      { onError: (e) => Alert.alert("Couldn't seat the party", errorMessage(e)) },
                    )
                  }
                />
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function OrderRow({ o, event, dayOrders }: { o: PreorderOrder; event: PreorderEvent; dayOrders: PreorderOrder[] }) {
  const { seat, cancel, restore } = usePreorderMutations();
  const cancelled = o.status === "cancelled";
  const options = o.fulfillment_type === "dine_in" ? hoursWithRoom(event, dayOrders, o.quantity, o.id) : [];
  const fail = (e: unknown) => Alert.alert("Couldn't save", errorMessage(e));

  return (
    <View className={`gap-2 p-4 ${cancelled ? "opacity-60" : ""}`}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-base font-semibold text-white">
            {o.customer_name || "Unnamed"} <Text className="text-xs font-normal text-zinc-500">× {o.quantity}</Text>
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-500">
            {FULFILMENT_LABEL[o.fulfillment_type]} · {slotLabel(o)}
            {o.order_total ? ` · ${money(Number(o.order_total))}` : ""}
          </Text>
        </View>
        {cancelled ? <Badge tone="rose">cancelled</Badge> : o.timeslot_start || o.fulfillment_type !== "dine_in" ? null : <Badge tone="amber">to seat</Badge>}
      </View>
      {o.special_requests ? <Text className="text-xs text-violet-soft">{o.special_requests}</Text> : null}
      {o.fulfillment_type === "delivery" && o.address_street ? (
        <Text className="text-xs text-zinc-400">
          {[o.address_street, o.address_apartment, o.address_zip, o.address_city].filter(Boolean).join(", ")}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {o.customer_phone ? (
          <Button title="Call" variant="ghost" className="py-2" onPress={() => Linking.openURL(`tel:${o.customer_phone!.replace(/[^\d+]/g, "")}`)} />
        ) : null}
        {!cancelled && o.fulfillment_type === "dine_in" && o.timeslot_start ? (
          <Button
            title="Unseat"
            variant="ghost"
            className="py-2"
            onPress={() => seat.mutate({ id: o.id, startMin: null, slotMinutes: event.slot_minutes }, { onError: fail })}
          />
        ) : null}
        {cancelled ? (
          <Button title="Restore" variant="ghost" className="py-2" onPress={() => restore.mutate(o.id, { onError: fail })} />
        ) : (
          <Button
            title="Cancel"
            variant="danger"
            className="py-2"
            onPress={() =>
              Alert.alert("Cancel this order?", `${o.customer_name || "This party"} (× ${o.quantity}). You can restore it later.`, [
                { text: "Keep", style: "cancel" },
                { text: "Cancel order", style: "destructive", onPress: () => cancel.mutate(o.id, { onError: fail }) },
              ])
            }
          />
        )}
      </View>
      {options.length > 0 && !cancelled && o.timeslot_start ? (
        <Picker
          value=""
          title="Move to another seating"
          placeholder="Move to…"
          options={options.map((s) => ({ value: String(s.startMin), label: `${formatTime(minutesToTime(s.startMin))} · ${s.remaining} left` }))}
          onChange={(v) =>
            v && seat.mutate({ id: o.id, startMin: Number(v), slotMinutes: event.slot_minutes }, { onError: fail })
          }
        />
      ) : null}
    </View>
  );
}

/**
 * Event preorders on the phone: pick a service date, seat parties that still need a time, watch the hourly
 * capacity, and cancel or restore an order. Creating events, importing and the event settings stay on the website.
 */
export default function Preorders() {
  const eventsQ = usePreorderEvents();
  const events = eventsQ.data;
  const event = useMemo(() => events?.find((e) => e.is_active) ?? events?.[0], [events]);
  const orders = usePreorderOrders(event?.id).data;
  const [date, setDate] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const dates = useMemo(() => {
    const set = new Set<string>(event?.service_dates ?? []);
    for (const o of orders ?? []) set.add(o.requested_date);
    return [...set].sort();
  }, [event, orders]);

  // Open on the day that needs attention, as the website does.
  const defaultDate = useMemo(() => {
    if (dates.length === 0) return null;
    const on = (d: string) => (orders ?? []).filter((o) => o.requested_date === d);
    return (
      dates.find((d) => computeDayTotals(on(d)).coversUnplaced > 0) ??
      dates.find((d) => on(d).length > 0) ??
      dates[0]
    );
  }, [dates, orders]);

  const selected = date && dates.includes(date) ? date : defaultDate;
  const dayOrders = useMemo(() => (orders ?? []).filter((o) => o.requested_date === selected), [orders, selected]);
  const slots = useMemo(() => (event ? computeHourCapacity(event, dayOrders) : []), [event, dayOrders]);
  const queue = useMemo(() => unassignedParties(dayOrders), [dayOrders]);
  const totals = useMemo(() => computeDayTotals(dayOrders), [dayOrders]);
  const listed = dayOrders.filter((o) => showCancelled || o.status === "confirmed");
  const overbooked = slots.filter((s) => s.state === "over");

  if (!event) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <Muted>{eventsQ.isLoading ? "Loading…" : "No preorder event yet. Create one on the website."}</Muted>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-3">
        <View>
          <Text className="text-2xl font-bold text-white">{event.name}</Text>
          <Muted>
            {event.dine_in_capacity} covers per seating · {event.day_start_hour}:00–{event.day_end_hour}:00
          </Muted>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-none" contentContainerClassName="gap-2">
          {dates.map((d) => {
            const t = computeDayTotals((orders ?? []).filter((o) => o.requested_date === d));
            const active = d === selected;
            return (
              <Pressable
                key={d}
                onPress={() => setDate(d)}
                className={`rounded-xl border px-4 py-2.5 ${active ? "border-brand-400/50 bg-brand-400/10" : "border-line bg-white/5"}`}
              >
                <Text className={`text-sm font-semibold ${active ? "text-white" : "text-zinc-300"}`}>
                  {dayLabel(d)}
                  {t.coversUnplaced > 0 ? <Text className="text-rose-soft"> ●</Text> : null}
                </Text>
                <Text className="text-xs text-zinc-500">{t.covers === 0 ? "empty" : `${t.covers} covers`}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {selected ? (
          <>
            <View className="flex-row flex-wrap gap-3">
              <Stat label="Covers" value={String(totals.covers)} hint={`${totals.orders} orders`} />
              <Stat label="Seated" value={String(totals.coversSeated)} hint="dine-in placed" />
              <Stat
                label="To seat"
                value={String(totals.coversUnplaced)}
                hint={totals.coversUnplaced > 0 ? "needs a time" : "all placed"}
                urgent={totals.coversUnplaced > 0}
              />
              <Stat label="Takeaway" value={String(totals.takeawayCovers)} hint={`${totals.takeawayOrders} orders`} />
            </View>

            {overbooked.length > 0 ? (
              <Card className="border-rose-soft/30">
                <Text className="text-sm font-semibold text-rose-soft">
                  {overbooked.length === 1 ? "One seating is over capacity" : `${overbooked.length} seatings are over capacity`}
                </Text>
                <Muted className="mt-1">
                  {overbooked.map((s) => `${formatTime(minutesToTime(s.startMin))} has ${s.booked} of ${s.capacity}`).join(" · ")}.
                  Move a party to another seating.
                </Muted>
              </Card>
            ) : null}

            {queue.length > 0 ? <QueueCard event={event} queue={queue} dayOrders={dayOrders} /> : null}

            <View>
              <Text className="mb-2 text-lg font-bold text-white">Seatings</Text>
              <Card className="gap-3">
                {slots.map((s) => (
                  <View key={s.startMin}>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-semibold text-white">{formatTime(minutesToTime(s.startMin))}</Text>
                      <Text className={`text-xs ${s.state === "over" ? "font-bold text-rose-soft" : "text-zinc-400"}`}>
                        {s.booked}/{s.capacity}
                      </Text>
                    </View>
                    <View className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                      <View
                        className={`h-full ${SLOT_BAR[s.state]}`}
                        style={{ width: `${Math.min(100, s.capacity > 0 ? (s.booked / s.capacity) * 100 : 0)}%` }}
                      />
                    </View>
                    {s.parties.length > 0 ? (
                      <Text className="mt-1 text-xs text-zinc-500">
                        {s.parties.map((p) => `${p.order.customer_name || "?"} (${p.order.quantity})`).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </Card>
            </View>

            <View>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-lg font-bold text-white">Orders</Text>
                <Pressable onPress={() => setShowCancelled((v) => !v)}>
                  <Text className="text-sm font-semibold text-brand-300">
                    {showCancelled ? "Hide cancelled" : "Show cancelled"}
                  </Text>
                </Pressable>
              </View>
              {listed.length === 0 ? (
                <Card>
                  <Muted className="py-6 text-center">No orders for this day.</Muted>
                </Card>
              ) : (
                <Card className="p-0">
                  {listed.map((o, i) => (
                    <View key={o.id}>
                      {i > 0 ? <Divider /> : null}
                      <OrderRow o={o} event={event} dayOrders={dayOrders} />
                    </View>
                  ))}
                </Card>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
