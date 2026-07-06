import { useEffect, useRef, useState } from "react";
import { ScrollView, View, Text, Alert, Linking, Platform } from "react-native";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Badge, Muted } from "@/components/ui";
import { useMyDeliveries, useDeliveryMutations } from "@/lib/hooks";
import { money } from "@/lib/format";
import { colors } from "@/lib/theme";
import type { DeliveryWithOrder } from "@/lib/api/delivery";

const REPORT_INTERVAL_MS = 15000;
const REPORT_DISTANCE_M = 50;

/** Opens the address in the platform's native maps app for turn-by-turn
 * directions; falls back to the universal Google Maps web link if the
 * native scheme isn't handled (e.g. simulators without Maps installed). */
function openRoute(address: string) {
  const encoded = encodeURIComponent(address);
  const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
  const nativeUrl =
    Platform.OS === "ios" ? `maps://app?daddr=${encoded}` : `google.navigation:q=${encoded}`;
  Linking.openURL(nativeUrl).catch(() => Linking.openURL(webFallback));
}

function DeliveryCard({
  delivery,
  starting,
  delivering,
  sharingLocation,
  onStart,
  onMarkDelivered,
}: {
  delivery: DeliveryWithOrder;
  starting: boolean;
  delivering: boolean;
  sharingLocation: boolean;
  onStart: () => void;
  onMarkDelivered: () => void;
}) {
  const active = delivery.status === "picked_up";
  return (
    <Card className="mb-3">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-base font-semibold text-white">
            {delivery.order?.guest_name ?? "Guest"}
          </Text>
          <Muted className="mt-0.5">{delivery.address}</Muted>
        </View>
        <Badge tone={active ? "green" : "amber"}>{active ? "On the way" : "Assigned"}</Badge>
      </View>

      {delivery.order ? (
        <View className="mt-3 gap-1">
          {delivery.order.items.map((l, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Text className="text-sm font-bold text-brand-300">{l.qty}×</Text>
              <Text className="text-sm text-zinc-300">{l.name}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between border-t border-line pt-3">
        <Muted>
          {delivery.order ? `${delivery.order.order_number} · ${money(delivery.order.total)}` : ""}
        </Muted>
      </View>
      {delivery.notes ? <Muted className="mt-1 italic">{delivery.notes}</Muted> : null}

      {active && sharingLocation ? (
        <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-brand-500/10 px-3 py-2">
          <Ionicons name="navigate" size={16} color={colors.brand400} />
          <Text className="text-xs font-semibold text-brand-300">Sharing your location live</Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <Button
          title="Open route"
          variant="ghost"
          className="flex-1"
          onPress={() => openRoute(delivery.address)}
        />
        {!active ? (
          <Button title="Start trip" className="flex-[2]" loading={starting} onPress={onStart} />
        ) : (
          <Button
            title="Mark delivered"
            className="flex-[2]"
            loading={delivering}
            onPress={onMarkDelivered}
          />
        )}
      </View>
    </Card>
  );
}

export default function Delivery() {
  const deliveriesQ = useMyDeliveries();
  const { startTrip, markDelivered, reportLocation } = useDeliveryMutations();
  const deliveries = deliveriesQ.data ?? [];
  const activeDelivery = deliveries.find((d) => d.status === "picked_up") ?? null;
  const [sharingLocation, setSharingLocation] = useState(false);
  const watchRef = useRef<Location.LocationSubscription | null>(null);

  // Exactly one trip can be "active" (picked_up) at a time for this rider —
  // start/stop the foreground GPS watch as that changes, never in the background.
  useEffect(() => {
    let cancelled = false;

    async function startWatch(deliveryId: string) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        Alert.alert(
          "Location needed",
          "Enable location access so the customer can see you're on the way.",
        );
        return;
      }
      setSharingLocation(true);
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: REPORT_INTERVAL_MS,
          distanceInterval: REPORT_DISTANCE_M,
        },
        (loc) => {
          reportLocation.mutate({
            deliveryId,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        },
      );
    }

    if (activeDelivery) {
      startWatch(activeDelivery.id);
    } else {
      setSharingLocation(false);
    }

    return () => {
      cancelled = true;
      watchRef.current?.remove();
      watchRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDelivery?.id]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="py-3 pb-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-lg font-bold text-white">Your deliveries</Text>
          <Badge tone="accent">{deliveries.length} active</Badge>
        </View>
        {deliveries.length === 0 ? (
          <Card>
            <Muted className="py-6 text-center">No deliveries assigned right now.</Muted>
          </Card>
        ) : (
          deliveries.map((d) => (
            <DeliveryCard
              key={d.id}
              delivery={d}
              starting={startTrip.isPending}
              delivering={markDelivered.isPending}
              sharingLocation={sharingLocation && activeDelivery?.id === d.id}
              onStart={() => startTrip.mutate(d.id)}
              onMarkDelivered={() => markDelivered.mutate(d.id)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
