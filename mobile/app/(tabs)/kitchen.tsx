import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/ui";
import Board from "@/components/kitchen/Board";
import KitchenOps from "@/components/kitchen/KitchenOps";
import { useOrg } from "@/lib/org-context";
import { hasModule } from "@/lib/api/session";

/**
 * Kitchen is two things on the website — the live ticket board and Kitchen Ops (counts and prep) — each with its
 * own access switch, so each is its own view here. With only one of them switched on, there's no switcher at all.
 */
export default function Kitchen() {
  const { ctx } = useOrg();
  const hasBoard = hasModule(ctx, "kitchen");
  const hasOps = hasModule(ctx, "kitchenops");
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<"board" | "ops">(hasBoard ? "board" : "ops");

  useEffect(() => {
    if (viewParam === "ops" && hasOps) setView("ops");
    else if (viewParam === "board" && hasBoard) setView("board");
  }, [viewParam, hasBoard, hasOps]);

  const showBoard = hasBoard && (view === "board" || !hasOps);

  return (
    <Screen>
      {hasBoard && hasOps ? (
        <View className="flex-row gap-2 pt-3">
          {(
            [
              ["board", "Board"],
              ["ops", "Kitchen Ops"],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setView(key)}
              className={`flex-1 items-center rounded-xl border py-2.5 ${
                view === key ? "border-brand-500 bg-brand-500/15" : "border-line bg-white/5"
              }`}
            >
              <Text className={`text-sm font-semibold ${view === key ? "text-brand-300" : "text-zinc-400"}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {showBoard ? <Board /> : <KitchenOps />}
    </Screen>
  );
}
