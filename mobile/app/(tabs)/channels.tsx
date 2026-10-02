import { Alert, ScrollView, View, Text } from "react-native";
import { Screen, Card, Button, Badge, Muted, Divider } from "@/components/ui";
import { useChannelOrders, useDecideChannelOrder } from "@/lib/hooks";
import { PROVIDER_COLOR, PROVIDER_LABEL, minutesLeft } from "@/lib/api/channels";
import { agoMins, money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { ChannelOrder } from "@/lib/types";

const ago = (iso: string) => {
  const m = Math.max(0, agoMins(iso));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

function InboxCard({ co }: { co: ChannelOrder }) {
  const decide = useDecideChannelOrder();
  const unmapped = co.items.filter((l) => !l.recipe_id).length;
  const left = minutesLeft(co);

  const run = (accept: boolean) =>
    decide.mutate(
      { id: co.id, accept },
      {
        onSuccess: (ackError) => {
          if (ackError) {
            Alert.alert(
              accept ? "Accepted here, but not on the platform" : "Rejected here only",
              `${ackError}\n\nConfirm it on the platform tablet too.`,
            );
          }
        },
        onError: (e) => Alert.alert("Couldn't update the order", errorMessage(e)),
      },
    );

  return (
    <Card className="mb-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <View style={{ backgroundColor: PROVIDER_COLOR[co.provider] }} className="h-2.5 w-2.5 rounded-full" />
            <Text className="text-base font-bold text-white">
              {PROVIDER_LABEL[co.provider]} · #{co.external_display_id || co.external_id.slice(-6)}
            </Text>
          </View>
          <Muted className="mt-0.5">
            {co.order_type.replace("_", "-")}
            {co.customer_name ? ` · ${co.customer_name}` : ""} · {ago(co.received_at)}
          </Muted>
        </View>
        <View className="items-end">
          <Text className="text-base font-bold text-brand-300">{money(co.gross)}</Text>
          {left !== null ? (
            <Text className={`text-xs font-semibold ${left <= 3 ? "text-rose-soft" : "text-zinc-500"}`}>
              {left > 0 ? `${Math.ceil(left)}m to accept` : "window passed"}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-3 gap-1.5">
        {co.items.map((l, i) => (
          <View key={i} className="flex-row items-start gap-2">
            <View className="h-6 w-6 items-center justify-center rounded bg-white/10">
              <Text className="text-xs font-bold text-white">{l.qty}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-base text-zinc-200">
                {l.name}
                {!l.recipe_id ? <Text className="text-xs text-amber-soft"> · unmapped</Text> : null}
              </Text>
              {l.notes ? <Text className="text-xs text-zinc-500">{l.notes}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {co.notes ? (
        <Text className="mt-3 rounded-lg bg-amber-soft/10 p-2.5 text-xs text-amber-soft">{co.notes}</Text>
      ) : null}
      {unmapped > 0 ? (
        <Text className="mt-3 text-xs text-zinc-500">
          {unmapped} item{unmapped > 1 ? "s" : ""} didn't match a recipe — they ring up at the platform price but won't
          take stock off. Rename the recipe to match.
        </Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <Button title="Accept" className="flex-1" loading={decide.isPending} onPress={() => run(true)} />
        <Button title="Reject" variant="ghost" disabled={decide.isPending} onPress={() => run(false)} />
      </View>
    </Card>
  );
}

const STATUS_TONE = { accepted: "green", rejected: "rose", failed: "amber", pending: "accent" } as const;

/** Sales Channels inbox: platform orders waiting for a yes/no, and the last few decided. Connecting channels is on the website. */
export default function Channels() {
  const ordersQ = useChannelOrders();
  const all = ordersQ.data ?? [];
  const inbox = all.filter((o) => o.status === "pending");
  const recent = all.filter((o) => o.status !== "pending").slice(0, 12);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="pb-6 pt-3">
        <View className="mb-3 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-bold text-white">Channels</Text>
            <Muted>Wolt, Uber Eats and Lieferando orders.</Muted>
          </View>
          <Badge tone={inbox.length ? "rose" : "neutral"}>{`${inbox.length} waiting`}</Badge>
        </View>

        {inbox.length === 0 ? (
          <Card className="mb-4">
            <Muted className="py-6 text-center">No orders waiting. New ones appear here by themselves.</Muted>
          </Card>
        ) : (
          inbox.map((co) => <InboxCard key={co.id} co={co} />)
        )}

        {recent.length > 0 ? (
          <View className="mt-2">
            <Text className="mb-2 text-lg font-bold text-white">Recent</Text>
            <Card className="p-0">
              {recent.map((co, i) => (
                <View key={co.id}>
                  {i > 0 ? <Divider /> : null}
                  <View className="flex-row items-center gap-3 p-4">
                    <View style={{ backgroundColor: PROVIDER_COLOR[co.provider] }} className="h-2.5 w-2.5 rounded-full" />
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-white">
                        {PROVIDER_LABEL[co.provider]} · #{co.external_display_id || co.external_id.slice(-6)}
                      </Text>
                      <Text className="text-xs text-zinc-500">
                        {co.customer_name ? `${co.customer_name} · ` : ""}
                        {money(co.gross)} · {ago(co.received_at)}
                      </Text>
                    </View>
                    <Badge tone={STATUS_TONE[co.status]}>{co.status}</Badge>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
