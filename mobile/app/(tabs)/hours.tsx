import { ScrollView, View, Text } from "react-native";
import { Screen, Card, Badge, Muted, Divider } from "@/components/ui";
import { useMyTimeEntries } from "@/lib/hooks";
import { weekStartKey } from "@/lib/dates";
import type { TimeEntry } from "@/lib/types";

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Hours worked on an entry; a shift still open counts up to now. Breaks come off. */
function workedHours(e: TimeEntry): number {
  const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now();
  const onBreak = e.break_started_at && !e.clock_out ? Date.now() - new Date(e.break_started_at).getTime() : 0;
  return Math.max(0, (end - new Date(e.clock_in).getTime() - e.break_seconds * 1000 - onBreak) / 3_600_000);
}

/** My timesheet — the last four weeks of my own shifts, newest first, grouped by week. */
export default function MyHours() {
  const entries = useMyTimeEntries().data ?? [];

  const weeks = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const key = weekStartKey(new Date(e.clock_in));
    weeks.set(key, [...(weeks.get(key) ?? []), e]);
  }
  const thisWeek = weekStartKey(new Date());

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-2">
        <View>
          <Text className="text-2xl font-bold text-white">My hours</Text>
          <Muted>Your shifts from the last four weeks.</Muted>
        </View>

        {entries.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">No shifts yet. Clock in on My Day to start one.</Muted>
          </Card>
        ) : (
          [...weeks.entries()].map(([weekKey, list]) => {
            const total = list.reduce((s, e) => s + workedHours(e), 0);
            const start = new Date(`${weekKey}T00:00:00`);
            const end = new Date(start);
            end.setDate(end.getDate() + 6);
            const label = `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
            return (
              <View key={weekKey}>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className="text-lg font-bold text-white">{weekKey === thisWeek ? "This week" : label}</Text>
                  <Badge tone="green">
                    {total.toFixed(1)}h · {list.length} shift{list.length === 1 ? "" : "s"}
                  </Badge>
                </View>
                <Card className="p-0">
                  {list.map((e, i) => {
                    const d = new Date(e.clock_in);
                    return (
                      <View key={e.id}>
                        {i > 0 ? <Divider /> : null}
                        <View className="flex-row items-center gap-4 p-4">
                          <View className="w-16">
                            <Text className="text-sm font-semibold text-white">
                              {d.toLocaleDateString(undefined, { weekday: "short" })}
                            </Text>
                            <Text className="text-xs text-zinc-500">
                              {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                            </Text>
                          </View>
                          <View className="flex-1">
                            <Text className="text-base font-medium text-white">
                              {clock(e.clock_in)} – {e.clock_out ? clock(e.clock_out) : "now"}
                            </Text>
                            {e.break_seconds > 0 ? (
                              <Text className="text-xs text-zinc-500">{Math.round(e.break_seconds / 60)} min break</Text>
                            ) : null}
                          </View>
                          {e.clock_out ? (
                            <Text className="text-base font-semibold text-brand-300">{workedHours(e).toFixed(1)}h</Text>
                          ) : (
                            <Badge tone="amber">On shift</Badge>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </Card>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
