import { useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Badge, Button, Muted, Divider } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useMyAvailability, useAvailabilityMutations } from "@/lib/hooks";
import { dayKey, weekDays, weekLabel, shortTime } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import type { AvailabilityStatus, StaffAvailability } from "@/lib/types";

const OPTIONS: { id: AvailabilityStatus; label: string; icon: keyof typeof Ionicons.glyphMap; tone: string }[] = [
  { id: "available", label: "Available", icon: "checkmark", tone: "border-brand-400/40 bg-brand-500/15" },
  { id: "partial", label: "Some hours", icon: "time-outline", tone: "border-amber-soft/40 bg-amber-soft/10" },
  { id: "unavailable", label: "Off", icon: "close", tone: "border-rose-soft/40 bg-rose-soft/10" },
];
const ACTIVE_TEXT: Record<AvailabilityStatus, string> = {
  available: "text-brand-300",
  partial: "text-amber-soft",
  unavailable: "text-rose-soft",
};
const ACTIVE_ICON: Record<AvailabilityStatus, string> = {
  available: colors.brand300,
  partial: colors.amber,
  unavailable: colors.rose,
};
const DEFAULT_WINDOW = { from: "16:00", to: "23:00" };

/** "9:5" / "16" / "16:00" → "HH:MM", or null when it isn't a time. */
function normTime(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] == null ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const weekTabLabel = (offset: number) => (offset === 1 ? "Next week" : weekLabel(weekDays(offset)));

function DayRow({
  date,
  row,
  onSave,
  onClear,
}: {
  date: Date;
  row: StaffAvailability | undefined;
  onSave: (status: AvailabilityStatus, from: string, to: string, note: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [from, setFrom] = useState(shortTime(row?.from_time) || DEFAULT_WINDOW.from);
  const [to, setTo] = useState(shortTime(row?.to_time) || DEFAULT_WINDOW.to);
  const [note, setNote] = useState(row?.note ?? "");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Times and the note save when you leave the field, and only if they actually changed.
  const saveDetails = () => {
    if (!row) return;
    const f = normTime(from);
    const t = normTime(to);
    if (row.status === "partial" && (!f || !t)) {
      setFrom(shortTime(row.from_time) || DEFAULT_WINDOW.from);
      setTo(shortTime(row.to_time) || DEFAULT_WINDOW.to);
      return;
    }
    const changed =
      (row.status === "partial" && (f !== shortTime(row.from_time) || t !== shortTime(row.to_time))) ||
      note.trim() !== (row.note ?? "");
    if (changed) void run(() => onSave(row.status, f ?? DEFAULT_WINDOW.from, t ?? DEFAULT_WINDOW.to, note));
  };

  return (
    <View className={`gap-2 p-4 ${busy ? "opacity-60" : ""}`}>
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-base font-semibold text-white">{date.toLocaleDateString(undefined, { weekday: "long" })}</Text>
          <Text className="text-xs text-zinc-500">{date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Text>
        </View>
      </View>
      <View className="flex-row gap-1.5">
        {OPTIONS.map((opt) => {
          const active = row?.status === opt.id;
          return (
            <Pressable
              key={opt.id}
              disabled={busy}
              // Tapping the active choice again clears it back to "hasn't said".
              onPress={() =>
                run(() =>
                  active
                    ? onClear()
                    : onSave(opt.id, normTime(from) ?? DEFAULT_WINDOW.from, normTime(to) ?? DEFAULT_WINDOW.to, note),
                )
              }
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-lg border py-2.5 ${
                active ? opt.tone : "border-line bg-white/5"
              }`}
            >
              <Ionicons name={opt.icon} size={15} color={active ? ACTIVE_ICON[opt.id] : colors.zinc400} />
              <Text className={`text-xs font-semibold ${active ? ACTIVE_TEXT[opt.id] : "text-zinc-400"}`}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {row?.status === "partial" ? (
        <View className="flex-row items-center gap-2">
          <TextInput
            value={from}
            onChangeText={setFrom}
            onBlur={saveDetails}
            keyboardType="numbers-and-punctuation"
            placeholder="16:00"
            placeholderTextColor={colors.zinc500}
            maxLength={5}
            accessibilityLabel="Available from"
            className="w-24 rounded-lg border border-line bg-white/5 px-3 py-2 text-center text-white"
          />
          <Text className="text-xs text-zinc-500">to</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            onBlur={saveDetails}
            keyboardType="numbers-and-punctuation"
            placeholder="23:00"
            placeholderTextColor={colors.zinc500}
            maxLength={5}
            accessibilityLabel="Available until"
            className="w-24 rounded-lg border border-line bg-white/5 px-3 py-2 text-center text-white"
          />
        </View>
      ) : null}
      {row ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          onBlur={saveDetails}
          onSubmitEditing={saveDetails}
          placeholder="Note (optional)"
          placeholderTextColor={colors.zinc500}
          className="rounded-lg border border-line bg-white/5 px-3 py-2 text-white"
        />
      ) : null}
    </View>
  );
}

/** Tell your manager when you can work — shifts are planned from this. The phone twin of the website's planner. */
export default function AvailabilityScreen() {
  const { ctx } = useOrg();
  const me = ctx?.me;
  const q = useMyAvailability();
  const { set, clear } = useAvailabilityMutations();
  const [offset, setOffset] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);

  const days = weekDays(offset);
  const mine = new Map((q.data ?? []).map((r) => [r.day, r]));
  const unset = days.filter((d) => !mine.has(dayKey(d)));

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e, "Couldn't save that — please try again."));
    }
  };

  const fillRest = async () => {
    setFilling(true);
    await guard(async () => {
      for (const d of unset) await set.mutateAsync({ day: dayKey(d), input: { status: "available" } });
    });
    setFilling(false);
  };

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="gap-4 p-4 pb-10" showsVerticalScrollIndicator={false}>
      <View className="flex-row items-start gap-3">
        <View className="flex-1">
          <Text className="text-xl font-bold text-white">My availability</Text>
          <Muted>Let your manager know when you can work — shifts are planned from this.</Muted>
        </View>
        <Badge tone={unset.length === 0 ? "green" : "amber"}>{7 - unset.length}/7 days</Badge>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-none" contentContainerClassName="gap-2">
        {[1, 2, 3, 4].map((o) => (
          <Pressable
            key={o}
            onPress={() => setOffset(o)}
            className={`rounded-full border px-4 py-2 ${offset === o ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"}`}
          >
            <Text className={`text-sm font-semibold ${offset === o ? "text-black" : "text-zinc-300"}`}>{weekTabLabel(o)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {error ? <Text className="text-sm font-semibold text-rose-soft">{error}</Text> : null}

      <Card className="p-0">
        {days.map((d, i) => {
          const key = dayKey(d);
          const row = mine.get(key);
          return (
            <View key={`${key}-${row?.updated_at ?? "unset"}`}>
              {i > 0 ? <Divider /> : null}
              <DayRow
                date={d}
                row={row}
                onSave={(status, from, to, note) =>
                  guard(() => set.mutateAsync({ day: key, input: { status, from_time: from, to_time: to, note } }))
                }
                onClear={() => guard(() => clear.mutateAsync(key))}
              />
            </View>
          );
        })}
      </Card>

      {unset.length > 0 && me ? (
        <Button
          variant="ghost"
          loading={filling}
          title={unset.length === 7 ? "Available all week" : `Mark the other ${unset.length} days available`}
          onPress={fillRest}
        />
      ) : null}
    </ScrollView>
  );
}
