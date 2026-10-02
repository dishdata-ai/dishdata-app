import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Muted } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useUnclaimedEmployees, useClaimEmployee } from "@/lib/hooks";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";

/**
 * "Who are you?" — a login that isn't linked to a staff record can't clock in, see shifts or claim a meal, so
 * the first job is picking yourself. The same step the website's My Day shows. The database enforces that a
 * profile can only be claimed once (claim_employee, migration 0047).
 */
export default function ClaimEmployee() {
  const { refresh } = useOrg();
  const unclaimedQ = useUnclaimedEmployees(true);
  const claim = useClaimEmployee();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pick = async (id: string) => {
    setError(null);
    setBusyId(id);
    try {
      await claim.mutateAsync(id);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const list = unclaimedQ.data ?? [];

  return (
    <Card>
      <View className="items-center gap-1 pb-4">
        <Ionicons name="person-circle-outline" size={44} color={colors.brand400} />
        <Text className="text-xl font-bold text-white">Who are you?</Text>
        <Muted className="text-center">Pick your name once — your shifts, tasks and hours will show up here.</Muted>
      </View>

      {unclaimedQ.isLoading ? (
        <ActivityIndicator color={colors.brand400} />
      ) : list.length === 0 ? (
        <Muted className="py-4 text-center">
          No unclaimed profiles. Every employee here is already linked to an account — ask a manager to check the
          Staff screen on the website.
        </Muted>
      ) : (
        <View className="gap-2">
          {list.map((e) => (
            <Pressable
              key={e.id}
              disabled={busyId !== null}
              onPress={() => pick(e.id)}
              className="flex-row items-center gap-3 rounded-xl border border-line bg-white/5 p-3 active:opacity-80"
            >
              <View
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: `hsl(${e.avatar_hue}, 65%, 60%)` }}
              >
                <Text className="text-xs font-bold text-black">
                  {e.name
                    .split(" ")
                    .map((p) => p[0])
                    .join("")
                    .slice(0, 2)}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-base font-semibold text-white">{e.name}</Text>
                <Text className="text-xs text-zinc-500">{e.role_title}</Text>
              </View>
              {busyId === e.id ? <ActivityIndicator color={colors.brand400} /> : null}
            </Pressable>
          ))}
        </View>
      )}

      {error ? <Text className="mt-3 text-sm font-semibold text-rose-soft">{error}</Text> : null}
    </Card>
  );
}
