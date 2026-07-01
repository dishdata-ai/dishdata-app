import { ScrollView, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Badge, StatTile, Muted, Divider } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useShift, useShiftMutations, useTasks, useTaskMutations } from "@/lib/hooks";
import { elapsed, clockTime, money } from "@/lib/format";
import { colors } from "@/lib/theme";

export default function MyDay() {
  const { ctx } = useOrg();
  const me = ctx?.me;
  const shiftQ = useShift();
  const { clockIn, clockOut, toggleBreak } = useShiftMutations();
  const tasksQ = useTasks();
  const taskMut = useTaskMutations();

  const shift = shiftQ.data ?? null;
  const onBreak = Boolean(shift?.break_started_at);
  const tasks = tasksQ.data ?? [];
  const myTasks = tasks.filter((t) => t.assignee_employee_id === me?.id);
  const openTasks = myTasks.filter((t) => t.status !== "done");

  // Earnings estimate from elapsed worked minutes (minus banked break seconds).
  const workedMs = shift
    ? Date.now() - new Date(shift.clock_in).getTime() - shift.break_seconds * 1000
    : 0;
  const workedHrs = Math.max(0, workedMs / 3_600_000);
  const earnings = workedHrs * (me?.hourly_rate ?? 0);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-2">
        <View>
          <Text className="text-2xl font-bold text-white">
            Hi {me?.name?.split(" ")[0] ?? "there"} 👋
          </Text>
          <Muted>{me?.role_title ?? "Team member"} · {ctx?.org.name}</Muted>
        </View>

        {/* Shift card */}
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Ionicons
                name={shift ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={shift ? colors.brand400 : colors.zinc500}
              />
              <Text className="text-base font-semibold text-white">
                {shift ? (onBreak ? "On break" : "On shift") : "Off the clock"}
              </Text>
            </View>
            {shift ? (
              <Badge tone={onBreak ? "amber" : "green"}>
                {onBreak ? "Break" : `${elapsed(shift.clock_in)} worked`}
              </Badge>
            ) : null}
          </View>

          {shift ? (
            <>
              <Muted className="mt-1">
                Clocked in at {clockTime(shift.clock_in)}
                {me?.shift_note ? ` · ${me.shift_note}` : ""}
              </Muted>
              <View className="mt-4 flex-row gap-3">
                <Button
                  title={onBreak ? "End break" : "Start break"}
                  variant="ghost"
                  className="flex-1"
                  loading={toggleBreak.isPending}
                  onPress={() => toggleBreak.mutate(shift)}
                />
                <Button
                  title="Clock out"
                  variant="danger"
                  className="flex-1"
                  loading={clockOut.isPending}
                  onPress={() => clockOut.mutate(shift.id)}
                />
              </View>
            </>
          ) : (
            <View className="mt-4">
              <Button
                title="Clock in"
                loading={clockIn.isPending}
                onPress={() => clockIn.mutate()}
              />
            </View>
          )}
        </Card>

        {/* Stats */}
        <View className="flex-row gap-3">
          <StatTile label="Hours today" value={workedHrs.toFixed(1)} hint="incl. current shift" />
          <StatTile
            label="Est. earnings"
            value={money(earnings)}
            hint={`@ ${money(me?.hourly_rate ?? 0)}/hr`}
            tone="accent"
          />
          <StatTile label="Open tasks" value={String(openTasks.length)} hint="assigned to you" tone="violet" />
        </View>

        {/* Today's tasks */}
        <View>
          <Text className="mb-2 text-lg font-bold text-white">Your tasks</Text>
          <Card className="p-0">
            {myTasks.length === 0 ? (
              <View className="p-6">
                <Muted className="text-center">No tasks assigned. Enjoy the calm. 🌿</Muted>
              </View>
            ) : (
              myTasks.map((t, i) => (
                <View key={t.id}>
                  {i > 0 ? <Divider /> : null}
                  <View className="flex-row items-center gap-3 p-4">
                    <Ionicons
                      name={t.status === "done" ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={t.status === "done" ? colors.brand400 : colors.zinc500}
                      onPress={() =>
                        taskMut.mutate({
                          id: t.id,
                          status: t.status === "done" ? "todo" : "done",
                        })
                      }
                    />
                    <View className="flex-1">
                      <Text
                        className={`text-base ${
                          t.status === "done" ? "text-zinc-500 line-through" : "text-white"
                        }`}
                      >
                        {t.title}
                      </Text>
                    </View>
                    {t.priority === "high" && t.status !== "done" ? (
                      <Badge tone="rose">High</Badge>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}
