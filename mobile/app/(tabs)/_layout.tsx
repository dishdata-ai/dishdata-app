import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useOrg } from "@/lib/org-context";
import { colors } from "@/lib/theme";
import { SCREENS, useScreens } from "@/lib/screens";

export default function TabsLayout() {
  const { ctx, loading, refresh } = useOrg();
  const { bar } = useScreens();

  // Escape hatch: if the loading state ever lingers (a wedged network call),
  // surface a retry after a few seconds instead of an endless spinner.
  const [showRetry, setShowRetry] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowRetry(false);
      return;
    }
    const t = setTimeout(() => setShowRetry(true), 6000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: colors.base }}
      >
        <ActivityIndicator color={colors.brand400} size="large" />
        {showRetry && (
          <>
            <Text style={{ color: colors.zinc400, fontSize: 13 }}>Taking longer than usual…</Text>
            <Pressable
              onPress={() => refresh()}
              style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}
            >
              <Text style={{ color: colors.white, fontWeight: "600", fontSize: 13 }}>Retry</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }
  if (!ctx) return <Redirect href="/sign-in" />;

  const inBar = new Set(bar.map((s) => s.name));

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.base },
        headerTintColor: colors.white,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "700" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: 84,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.brand400,
        tabBarInactiveTintColor: colors.zinc500,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      {/* Every screen is registered so it can still be opened from More; only the ones in `bar` get a tab. */}
      {SCREENS.map((s) => (
        <Tabs.Screen
          key={s.name}
          name={s.name}
          options={{
            title: s.title,
            href: inBar.has(s.name) ? undefined : null,
            tabBarIcon: ({ color, size }) => <Ionicons name={s.icon} color={color} size={size} />,
          }}
        />
      ))}
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          href: undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal-circle" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
