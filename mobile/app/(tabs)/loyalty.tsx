import { useMemo, useState } from "react";
import { Alert, ScrollView, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Badge, Muted, Button, Divider, Input } from "@/components/ui";
import { useCustomers, useLoyaltyTiers, useLoyaltyEarnRules, useLoyaltyRewards, useAwardPoints, useRedeemReward } from "@/lib/hooks";
import { colors } from "@/lib/theme";
import type { Customer, LoyaltyTier, LoyaltyActionType } from "@/lib/types";

function tierFor(tiers: LoyaltyTier[], statusPoints: number): { current: LoyaltyTier | null; next: LoyaltyTier | null } {
  const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let current: LoyaltyTier | null = null;
  let next: LoyaltyTier | null = null;
  for (const t of sorted) {
    if (t.threshold <= statusPoints) current = t;
    else { next = t; break; }
  }
  return { current, next };
}

function CustomerRow({ customer, tiers }: { customer: Customer; tiers: LoyaltyTier[] }) {
  const [open, setOpen] = useState(false);
  const rulesQ = useLoyaltyEarnRules();
  const rewardsQ = useLoyaltyRewards();
  const award = useAwardPoints();
  const redeem = useRedeemReward();

  const statusPoints = customer.status_points ?? customer.points;
  const { current, next } = useMemo(() => tierFor(tiers, statusPoints), [tiers, statusPoints]);
  const progress = next && next.threshold > 0
    ? Math.min(100, Math.round((statusPoints / next.threshold) * 100))
    : 100;

  const claimableRules = (rulesQ.data ?? []).filter((r) => r.action_type !== "purchase");

  const doAward = (action: LoyaltyActionType, label: string) => {
    award.mutate(
      { customerId: customer.id, action },
      {
        onSuccess: (res) => {
          if (res.status === "ok") Alert.alert("Awarded", `+${res.awarded} points for ${label}`);
          else if (res.status === "already_claimed") Alert.alert("Already claimed", `${customer.name} already earned this one`);
          else Alert.alert("Nothing to claim", res.status);
        },
        onError: (e) => Alert.alert("Could not award", e instanceof Error ? e.message : "Try again"),
      },
    );
  };

  const doRedeem = (rewardId: string, label: string) => {
    redeem.mutate(
      { customerId: customer.id, rewardId },
      {
        onSuccess: (res) => Alert.alert(`${label} unlocked`, `Code ${res.code} — apply at checkout`),
        onError: (e) => Alert.alert("Could not redeem", e instanceof Error ? e.message : "Try again"),
      },
    );
  };

  return (
    <View>
      <Pressable className="flex-row items-center gap-3 p-4" onPress={() => setOpen((o) => !o)}>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-white">{customer.name}</Text>
            <Badge tone="amber">{current?.name ?? customer.tier}</Badge>
          </View>
          <Muted className="mt-0.5">
            {customer.points} pts · {customer.phone ?? customer.email ?? "no contact on file"}
          </Muted>
          {next ? (
            <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <View style={{ width: `${progress}%`, backgroundColor: colors.brand400 }} className="h-full rounded-full" />
            </View>
          ) : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.zinc500} />
      </Pressable>

      {open ? (
        <View className="gap-4 px-4 pb-4">
          {next ? (
            <Muted>{Math.max(0, next.threshold - statusPoints)} pts to {next.name}</Muted>
          ) : (
            <Muted>Top tier reached</Muted>
          )}

          {claimableRules.length > 0 ? (
            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Award a bonus</Text>
              {claimableRules.map((r) => (
                <View key={r.id} className="flex-row items-center justify-between rounded-xl border border-line bg-white/5 px-3 py-2.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-medium text-white">{r.label}</Text>
                    {r.points > 0 ? <Muted className="mt-0.5">+{r.points} points</Muted> : null}
                  </View>
                  <Button
                    title="Award"
                    variant="ghost"
                    loading={award.isPending}
                    onPress={() => doAward(r.action_type, r.label)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {(rewardsQ.data ?? []).length > 0 ? (
            <View className="gap-2">
              <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Redeem a reward</Text>
              {(rewardsQ.data ?? []).map((r) => {
                const canAfford = customer.points >= r.cost_points;
                return (
                  <View key={r.id} className="flex-row items-center justify-between rounded-xl border border-line bg-white/5 px-3 py-2.5">
                    <View className="flex-1 pr-2">
                      <Text className="text-sm font-medium text-white">{r.label}</Text>
                      <Muted className="mt-0.5">{r.cost_points} points</Muted>
                    </View>
                    <Button
                      title="Redeem"
                      variant={canAfford ? "primary" : "ghost"}
                      disabled={!canAfford}
                      loading={redeem.isPending}
                      onPress={() => doRedeem(r.id, r.label)}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}
      <Divider />
    </View>
  );
}

export default function Loyalty() {
  const custQ = useCustomers();
  const tiersQ = useLoyaltyTiers();
  const [search, setSearch] = useState("");

  const customers = useMemo(() => {
    const list = custQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone?.includes(q) || c.email?.toLowerCase().includes(q),
    );
  }, [custQ.data, search]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="py-3 pb-6">
        <Text className="mb-3 text-lg font-bold text-white">Loyalty</Text>
        <Input
          placeholder="Search by name, phone, or email"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          className="mb-3"
        />
        <Card className="p-0">
          {customers.length === 0 ? (
            <Muted className="p-4">No customers match "{search}"</Muted>
          ) : (
            customers.map((c) => <CustomerRow key={c.id} customer={c} tiers={tiersQ.data ?? []} />)
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
