import { View, Text } from "react-native";
import { Card, Muted, Divider } from "@/components/ui";
import { useMyShifts } from "@/lib/hooks";
import { dayKey, shortTime } from "@/lib/dates";

/** What your manager has scheduled you for, from today on. */
export default function MyShifts() {
  const shifts = useMyShifts().data ?? [];
  const today = dayKey(new Date());

  return (
    <View>
      <Text className="mb-2 text-lg font-bold text-white">My shifts</Text>
      <Card className="p-0">
        {shifts.length === 0 ? (
          <View className="p-6">
            <Muted className="text-center">Nothing scheduled yet. Shifts your manager assigns show up here.</Muted>
          </View>
        ) : (
          shifts.map((s, i) => {
            const d = new Date(`${s.day}T00:00:00`);
            const isToday = s.day === today;
            return (
              <View key={s.id}>
                {i > 0 ? <Divider /> : null}
                <View className="flex-row items-center gap-4 p-4">
                  <View className="w-16">
                    <Text className={`text-sm font-semibold ${isToday ? "text-brand-300" : "text-white"}`}>
                      {isToday ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })}
                    </Text>
                    <Text className="text-xs text-zinc-500">
                      {d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-white">
                      {shortTime(s.start_time)}–{shortTime(s.end_time)}
                    </Text>
                    {s.role_title || s.note ? (
                      <Text className="text-xs text-zinc-500" numberOfLines={1}>
                        {[s.role_title, s.note].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}
