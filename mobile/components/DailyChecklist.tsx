import { useMemo, useState } from "react";
import { Alert, ScrollView, View, Text, Pressable, Image, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { Card, Badge, Muted, Divider } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useTasks, useDuties, useDailyTaskMutation, useAddProofPhoto } from "@/lib/hooks";
import { DUTY_LABELS, DUTY_ORDER, myDuties } from "@/lib/duties";
import { isDoneToday, stepsToday, proofToday, photoProofOn } from "@/lib/daily";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";
import type { StaffRole, Task } from "@/lib/types";

type Tone = "green" | "amber" | "rose" | "violet" | "accent" | "neutral";

const DUTY_TONE: Record<StaffRole, Tone> = {
  frontend: "accent",
  frontend_helper: "green",
  kitchen_lead: "amber",
  commi_kitchen: "violet",
  kitchen_helper: "rose",
  owner: "rose",
  admin: "rose",
  manager: "amber",
};

/**
 * Today's checklists, grouped by duty — the phone version of Tasks → Daily on the web. Everyone starts on
 * the duties they hold and can flip to "Everyone" to see who needs a hand. Ticking works the same way as the
 * web: a checklist resets itself each day because completed_at doubles as "last touched".
 */
export default function DailyChecklist() {
  const { ctx } = useOrg();
  const me = ctx?.me ?? null;
  const tasksQ = useTasks();
  const dutiesQ = useDuties();
  const mut = useDailyTaskMutation();
  const photoMut = useAddProofPhoto();
  const photosOn = photoProofOn(ctx?.org);
  const [shooting, setShooting] = useState<string | null>(null);
  const [view, setView] = useState<"mine" | "all" | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const mine = useMemo(() => myDuties(dutiesQ.data ?? [], me, me?.user_id ?? undefined), [dutiesQ.data, me]);
  // Same default as the web: your own duties if you hold any, otherwise everything.
  const effective = view ?? (mine.size > 0 ? "mine" : "all");

  const groups = useMemo(() => {
    const daily = (tasksQ.data ?? []).filter((t) => t.is_daily && !t.is_partner_task);
    return DUTY_ORDER.map((role) => ({
      role,
      tasks: daily.filter((t) => (t.assigned_role ?? null) === role).sort((a, b) => a.position - b.position),
    })).filter((g) => g.tasks.length > 0 && (effective === "all" || g.role === null || (g.role && mine.has(g.role))));
  }, [tasksQ.data, effective, mine]);

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleTask = (task: Task) => {
    const done = !isDoneToday(task);
    if (done && photosOn && task.requires_photo && proofToday(task).length === 0) {
      // The manager asked for proof: open the camera instead of ticking it off without one.
      Alert.alert("Photo needed", "This one needs a photo of the finished work.", [
        { text: "Not now", style: "cancel" },
        { text: "Take photo", onPress: () => takePhoto(task, true) },
      ]);
      return;
    }
    mut.mutate({
      id: task.id,
      patch: {
        status: done ? "done" : "todo",
        completed_at: new Date().toISOString(),
        checklist: stepsToday(task).map((c) => ({ ...c, done })),
      },
    });
  };

  /** Open the camera, upload the shot, and (when it was needed to finish the task) tick the task off. */
  const takePhoto = async (task: Task, thenTick = false) => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Camera is off", "Allow camera access for DishData in your phone's settings to add a photo.");
        return;
      }
      const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5, exif: false });
      if (shot.canceled || !shot.assets?.[0]) return;
      setShooting(task.id);
      await photoMut.mutateAsync({ task, uri: shot.assets[0].uri });
      if (thenTick) {
        mut.mutate({
          id: task.id,
          patch: {
            status: "done",
            completed_at: new Date().toISOString(),
            checklist: stepsToday(task).map((c) => ({ ...c, done: true })),
          },
        });
      }
    } catch (e) {
      Alert.alert("Couldn't add the photo", errorMessage(e));
    } finally {
      setShooting(null);
    }
  };

  const toggleStep = (task: Task, stepId: string) => {
    const next = stepsToday(task).map((c) => (c.id === stepId ? { ...c, done: !c.done } : c));
    mut.mutate({
      id: task.id,
      patch: {
        checklist: next,
        status: next.every((c) => c.done) ? "done" : "todo",
        completed_at: new Date().toISOString(),
      },
    });
  };

  return (
    <View className="flex-1">
      {mine.size > 0 ? (
        <View className="flex-row gap-2 pb-3">
          {(["mine", "all"] as const).map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              className={`rounded-full border px-4 py-2 ${
                effective === v ? "border-brand-500 bg-brand-500" : "border-line bg-white/5"
              }`}
            >
              <Text className={`text-sm font-semibold ${effective === v ? "text-black" : "text-zinc-300"}`}>
                {v === "mine" ? "My duties" : "Everyone"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6">
        {groups.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">
              {effective === "mine"
                ? "Nothing on your duties today. Switch to Everyone to see the whole team's checklists."
                : "No daily tasks yet. Managers add them on the website."}
            </Muted>
          </Card>
        ) : (
          groups.map(({ role, tasks }) => {
            const done = tasks.filter(isDoneToday).length;
            return (
              <Card key={role ?? "unassigned"} className="p-0">
                <View className="gap-2 border-b border-line p-4">
                  <View className="flex-row items-center justify-between">
                    <Badge tone={role ? DUTY_TONE[role] : "neutral"}>
                      {role ? DUTY_LABELS[role] : "Unassigned"}
                    </Badge>
                    <Text className="text-sm text-zinc-400">
                      {done} / {tasks.length} done
                    </Text>
                  </View>
                  <View className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <View
                      className="h-full bg-brand-400"
                      style={{ width: `${(done / tasks.length) * 100}%` }}
                    />
                  </View>
                </View>

                {tasks.map((task, i) => {
                  const steps = stepsToday(task);
                  const finished = isDoneToday(task);
                  const proof = proofToday(task);
                  const needsPhoto = photosOn && !!task.requires_photo && proof.length === 0;
                  const expanded = open.has(task.id);
                  return (
                    <View key={task.id}>
                      {i > 0 ? <Divider /> : null}
                      <View className="flex-row items-start gap-3 p-4">
                        <Pressable
                          onPress={() => toggleTask(task)}
                          hitSlop={10}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: finished }}
                          accessibilityLabel={task.title}
                        >
                          <Ionicons
                            name={finished ? "checkmark-circle" : "ellipse-outline"}
                            size={28}
                            color={finished ? colors.brand400 : colors.zinc500}
                          />
                        </Pressable>
                        <Pressable className="flex-1" onPress={() => steps.length > 0 && toggleOpen(task.id)}>
                          <Text className={`text-base ${finished ? "text-zinc-500 line-through" : "text-white"}`}>
                            {task.title}
                          </Text>
                          {task.description ? <Muted className="mt-0.5">{task.description}</Muted> : null}
                          <View className="mt-1 flex-row flex-wrap items-center gap-3">
                            {needsPhoto && !finished ? (
                              <View className="flex-row items-center gap-1">
                                <Ionicons name="camera-outline" size={14} color={colors.amber} />
                                <Text className="text-xs text-amber-soft">Photo needed</Text>
                              </View>
                            ) : null}
                            {steps.length > 0 ? (
                              <View className="flex-row items-center gap-1">
                                <Ionicons
                                  name={expanded ? "chevron-up" : "chevron-down"}
                                  size={14}
                                  color={colors.zinc400}
                                />
                                <Text className="text-xs text-zinc-400">
                                  {steps.filter((c) => c.done).length}/{steps.length} steps
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          {photosOn && (task.requires_photo || proof.length > 0 || task.example_photo_url) ? (
                            <View className="mt-2 gap-2">
                              <View className="flex-row flex-wrap items-center gap-2">
                                {proof.map((p) => (
                                  <Image key={p.id} source={{ uri: p.url }} className="h-16 w-16 rounded-lg" />
                                ))}
                                <Pressable
                                  onPress={() => takePhoto(task)}
                                  disabled={shooting === task.id}
                                  className="flex-row items-center gap-1.5 rounded-lg border border-line bg-white/5 px-3 py-2 active:opacity-70"
                                >
                                  {shooting === task.id ? (
                                    <ActivityIndicator size="small" color={colors.brand300} />
                                  ) : (
                                    <Ionicons name="camera-outline" size={16} color={colors.brand300} />
                                  )}
                                  <Text className="text-xs font-semibold text-brand-300">
                                    {proof.length > 0 ? "Add another" : "Add photo"}
                                  </Text>
                                </Pressable>
                              </View>
                              {task.example_photo_url ? (
                                <View>
                                  <Text className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">How it should look</Text>
                                  <Image source={{ uri: task.example_photo_url }} className="h-28 w-40 rounded-lg" resizeMode="cover" />
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                          {expanded
                            ? steps.map((c) => (
                                <Pressable
                                  key={c.id}
                                  onPress={() => toggleStep(task, c.id)}
                                  hitSlop={6}
                                  className="mt-2 flex-row items-center gap-2"
                                >
                                  <Ionicons
                                    name={c.done ? "checkbox" : "square-outline"}
                                    size={20}
                                    color={c.done ? colors.brand400 : colors.zinc500}
                                  />
                                  <Text className={`flex-1 text-sm ${c.done ? "text-zinc-500 line-through" : "text-zinc-200"}`}>
                                    {c.text}
                                  </Text>
                                </Pressable>
                              ))
                            : null}
                        </Pressable>
                        {task.priority === "high" && !finished ? <Badge tone="rose">High</Badge> : null}
                      </View>
                    </View>
                  );
                })}
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
