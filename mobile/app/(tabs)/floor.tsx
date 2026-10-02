import { useMemo, useState } from "react";
import { Alert, Modal, ScrollView, View, Text, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Badge, Muted, Divider, Input, Picker } from "@/components/ui";
import { useTables, useReservations, useFloorMutations } from "@/lib/hooks";
import { dayKey } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import type { RestaurantTable, Reservation, ReservationStatus, TableStatus } from "@/lib/types";

const TONE: Record<TableStatus, { border: string; bg: string; label: string }> = {
  open: { border: "border-brand-400/50", bg: "bg-brand-400/10", label: "Open" },
  seated: { border: "border-rose-soft/50", bg: "bg-rose-soft/10", label: "Seated" },
  reserved: { border: "border-violet-soft/50", bg: "bg-violet-soft/10", label: "Reserved" },
  cleaning: { border: "border-amber-soft/50", bg: "bg-amber-soft/10", label: "Cleaning" },
};

const NEXT_TABLE_STATUS: Record<TableStatus, TableStatus> = {
  open: "seated",
  seated: "cleaning",
  cleaning: "open",
  reserved: "seated",
};

const RES_TONE: Record<ReservationStatus, "accent" | "green" | "neutral" | "rose" | "amber"> = {
  booked: "accent",
  seated: "green",
  completed: "neutral",
  no_show: "rose",
  cancelled: "amber",
};

/** Half-hourly slots across a restaurant day. */
const TIMES = Array.from({ length: 24 }, (_, i) => {
  const mins = 11 * 60 + i * 30;
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
});

function Chip({ active, onPress, children }: { active: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-4 py-2 ${active ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"}`}
    >
      <Text className={`text-sm font-semibold ${active ? "text-black" : "text-zinc-300"}`}>{children}</Text>
    </Pressable>
  );
}

function BookingModal({
  open,
  tables,
  onClose,
}: {
  open: boolean;
  tables: RestaurantTable[];
  onClose: () => void;
}) {
  const { book } = useFloorMutations();
  const days = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return {
          key: dayKey(d),
          label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
        };
      }),
    [],
  );
  const [guest, setGuest] = useState("");
  const [phone, setPhone] = useState("");
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(days[0].key);
  const [time, setTime] = useState("19:00");
  const [tableId, setTableId] = useState("");
  const [note, setNote] = useState("");

  const reset = () => {
    setGuest("");
    setPhone("");
    setParty(2);
    setDate(days[0].key);
    setTime("19:00");
    setTableId("");
    setNote("");
  };

  const submit = () => {
    const when = new Date(`${date}T${time}:00`);
    book.mutate(
      {
        guest_name: guest.trim(),
        phone: phone.trim() || null,
        party_size: party,
        starts_at: when.toISOString(),
        table_id: tableId || null,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
        onError: (e) => Alert.alert("Couldn't book", errorMessage(e)),
      },
    );
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end bg-black/60">
        <View className="max-h-[92%] rounded-t-3xl border-t border-line bg-surface p-4 pb-8">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-lg font-bold text-white">New reservation</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.zinc400} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 pb-4">
            <View className="gap-1.5">
              <Muted>Guest name</Muted>
              <Input value={guest} onChangeText={setGuest} placeholder="Guest name" />
            </View>
            <View className="gap-1.5">
              <Muted>Phone (optional)</Muted>
              <Input value={phone} onChangeText={setPhone} placeholder="+49 30 …" keyboardType="phone-pad" />
            </View>
            <View className="gap-1.5">
              <Muted>Party size</Muted>
              <View className="flex-row items-center gap-4">
                <Pressable
                  onPress={() => setParty((p) => Math.max(1, p - 1))}
                  className="h-11 w-11 items-center justify-center rounded-xl bg-white/[0.08]"
                >
                  <Ionicons name="remove" size={22} color={colors.white} />
                </Pressable>
                <Text className="min-w-[32px] text-center text-2xl font-bold text-white">{party}</Text>
                <Pressable
                  onPress={() => setParty((p) => Math.min(30, p + 1))}
                  className="h-11 w-11 items-center justify-center rounded-xl bg-brand-400/20"
                >
                  <Ionicons name="add" size={22} color={colors.brand300} />
                </Pressable>
              </View>
            </View>
            <View className="gap-1.5">
              <Muted>Day</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {days.map((d) => (
                  <Chip key={d.key} active={date === d.key} onPress={() => setDate(d.key)}>
                    {d.label}
                  </Chip>
                ))}
              </ScrollView>
            </View>
            <View className="gap-1.5">
              <Muted>Time</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                {TIMES.map((t) => (
                  <Chip key={t} active={time === t} onPress={() => setTime(t)}>
                    {t}
                  </Chip>
                ))}
              </ScrollView>
            </View>
            <View className="gap-1.5">
              <Muted>Table (optional)</Muted>
              <Picker
                value={tableId}
                onChange={setTableId}
                title="Table"
                options={[
                  { label: "Assign later", value: "" },
                  ...tables
                    .filter((t) => t.status === "open")
                    .map((t) => ({ label: `${t.name} · ${t.seats} seats · ${t.zone}`, value: t.id })),
                ]}
              />
            </View>
            <View className="gap-1.5">
              <Muted>Note (optional)</Muted>
              <Input value={note} onChangeText={setNote} placeholder="Birthday, window seat…" />
            </View>
            <Button title="Book reservation" disabled={!guest.trim()} loading={book.isPending} onPress={submit} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReservationRow({ r, table }: { r: Reservation; table?: RestaurantTable }) {
  const { setReservation } = useFloorMutations();
  const when = new Date(r.starts_at);
  const act = (status: ReservationStatus) =>
    setReservation.mutate({ reservation: r, status }, { onError: (e) => Alert.alert("Couldn't update", errorMessage(e)) });
  return (
    <View className="gap-2 p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="text-base font-semibold text-white">
            {r.guest_name} <Text className="text-xs font-normal text-zinc-500">party of {r.party_size}</Text>
          </Text>
          <Text className="mt-0.5 text-xs text-zinc-500">
            {when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{" "}
            {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {table ? ` · ${table.name}` : ""}
            {r.phone ? ` · ${r.phone}` : ""}
            {r.note ? ` · ${r.note}` : ""}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Badge tone={RES_TONE[r.status]}>{r.status.replace("_", " ")}</Badge>
          {r.source === "public" ? <Badge tone="violet">online</Badge> : null}
        </View>
      </View>
      {r.status === "booked" ? (
        <View className="flex-row gap-2">
          <Button title="Seat" className="flex-1 py-2.5" onPress={() => act("seated")} />
          <Button title="No-show" variant="ghost" className="flex-1 py-2.5" onPress={() => act("no_show")} />
        </View>
      ) : null}
      {r.status === "seated" ? (
        <Button title="Complete" variant="ghost" className="py-2.5" onPress={() => act("completed")} />
      ) : null}
    </View>
  );
}

/** Floor & Reservations: tap a table to move it open → seated → cleaning → open; book and seat reservations. */
export default function Floor() {
  const tablesQ = useTables();
  const reservationsQ = useReservations();
  const { setTable } = useFloorMutations();
  const [booking, setBooking] = useState(false);

  const tables = tablesQ.data ?? [];
  const reservations = (reservationsQ.data ?? []).filter((r) => r.status === "booked" || r.status === "seated");
  const zones = useMemo(() => [...new Set(tables.map((t) => t.zone))], [tables]);
  const seated = tables.filter((t) => t.status === "seated").length;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-white">Floor</Text>
            <Muted>Tap a table: open → seated → cleaning.</Muted>
          </View>
          <Badge tone="accent">{`${seated}/${tables.length} seated`}</Badge>
        </View>

        <Button title="New reservation" onPress={() => setBooking(true)} />

        {tables.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">No tables yet. A manager adds the floor plan on the website.</Muted>
          </Card>
        ) : (
          zones.map((zone) => (
            <View key={zone}>
              <Text className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">{zone}</Text>
              <View className="flex-row flex-wrap gap-3">
                {tables
                  .filter((t) => t.zone === zone)
                  .map((t) => {
                    const tone = TONE[t.status];
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() =>
                          setTable.mutate(
                            { id: t.id, status: NEXT_TABLE_STATUS[t.status] },
                            { onError: (e) => Alert.alert("Couldn't update the table", errorMessage(e)) },
                          )
                        }
                        accessibilityLabel={`Table ${t.name}, ${tone.label}`}
                        className={`h-24 w-[30%] items-center justify-center gap-1 rounded-2xl border-2 active:opacity-70 ${tone.border} ${tone.bg}`}
                      >
                        <Text className="text-xl font-bold text-white">{t.name}</Text>
                        <Text className="text-xs text-zinc-400">
                          {t.seats} seats · {tone.label}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          ))
        )}

        <View>
          <Text className="mb-2 text-lg font-bold text-white">Upcoming reservations</Text>
          {reservations.length === 0 ? (
            <Card>
              <Muted className="py-6 text-center">No upcoming reservations.</Muted>
            </Card>
          ) : (
            <Card className="p-0">
              {reservations.map((r, i) => (
                <View key={r.id}>
                  {i > 0 ? <Divider /> : null}
                  <ReservationRow r={r} table={tables.find((t) => t.id === r.table_id)} />
                </View>
              ))}
            </Card>
          )}
        </View>
      </ScrollView>

      <BookingModal open={booking} tables={tables} onClose={() => setBooking(false)} />
    </Screen>
  );
}
