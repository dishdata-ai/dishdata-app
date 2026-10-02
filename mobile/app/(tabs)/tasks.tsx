import { useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Badge, Muted, Divider } from "@/components/ui";
import DailyChecklist from "@/components/DailyChecklist";
import { useOrg } from "@/lib/org-context";
import { hasModule } from "@/lib/api/session";
import { useTasks, useTaskMutations } from "@/lib/hooks";
import { colors } from "@/lib/theme";
import type { Task, TaskStatus } from "@/lib/types";

const FILTERS: { key: "all" | TaskStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "Doing" },
  { key: "done", label: "Done" },
];

const STATUS_ICON: Record<TaskStatus, keyof typeof Ionicons.glyphMap> = {
  todo: "ellipse-outline",
  in_progress: "time-outline",
  done: "checkmark-circle",
};

function nextStatus(s: TaskStatus): TaskStatus {
  return s === "todo" ? "in_progress" : s === "in_progress" ? "done" : "todo";
}

function Row({ task }: { task: Task }) {
  const mut = useTaskMutations();
  return (
    <View>
      <View className="flex-row items-center gap-3 p-4">
        <Pressable onPress={() => mut.mutate({ id: task.id, status: nextStatus(task.status) })}>
          <Ionicons
            name={STATUS_ICON[task.status]}
            size={26}
            color={
              task.status === "done"
                ? colors.brand400
                : task.status === "in_progress"
                  ? colors.amber
                  : colors.zinc500
            }
          />
        </Pressable>
        <View className="flex-1">
          <Text
            className={`text-base ${
              task.status === "done" ? "text-zinc-500 line-through" : "text-white"
            }`}
          >
            {task.title}
          </Text>
          {task.description ? <Muted className="mt-0.5">{task.description}</Muted> : null}
        </View>
        {task.priority === "high" && task.status !== "done" ? (
          <Badge tone="rose">High</Badge>
        ) : task.priority === "medium" && task.status !== "done" ? (
          <Badge tone="amber">Med</Badge>
        ) : null}
      </View>
      <Divider />
    </View>
  );
}

/** One-off tasks (the board). Daily checklists live in their own view — see DailyChecklist. */
function TaskList() {
  const tasksQ = useTasks();
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const tasks = (tasksQ.data ?? []).filter((t) => !t.is_daily);
  const shown = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="flex-none"
        contentContainerClassName="gap-2 py-3"
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            className={`self-start rounded-full border px-4 py-2 ${
              filter === f.key ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
            }`}
          >
            <Text
              className={`text-sm font-semibold ${
                filter === f.key ? "text-black" : "text-zinc-300"
              }`}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="pb-6">
        {shown.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">Nothing here.</Muted>
          </Card>
        ) : (
          <Card className="p-0">
            {shown.map((t) => (
              <Row key={t.id} task={t} />
            ))}
          </Card>
        )}
      </ScrollView>
    </>
  );
}

export default function Tasks() {
  const { ctx } = useOrg();
  // Daily is its own module on the web (Settings / Team & Access can switch it off per person), so it is here too.
  const hasDaily = hasModule(ctx, "dailytasks");
  const [mode, setMode] = useState<"tasks" | "daily">("tasks");
  const showDaily = hasDaily && mode === "daily";

  return (
    <Screen>
      {hasDaily ? (
        <View className="flex-row gap-2 pt-3">
          {(
            [
              ["tasks", "Tasks"],
              ["daily", "Daily"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setMode(key)}
              className={`flex-1 items-center rounded-xl border py-2.5 ${
                mode === key ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
              }`}
            >
              <Text className={`text-sm font-semibold ${mode === key ? "text-brand-300" : "text-zinc-400"}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {showDaily ? (
        <View className="flex-1 pt-3">
          <DailyChecklist />
        </View>
      ) : (
        <TaskList />
      )}
    </Screen>
  );
}
