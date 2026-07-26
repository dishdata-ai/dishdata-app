import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useOrg } from "@/lib/org-context";
import { colors } from "@/lib/theme";

export default function TabsLayout() {
  const { ctx, loading, refresh } = useOrg();

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
      <Tabs.Screen
        name="index"
        options={{
          title: "My Day",
          tabBarIcon: ({ color, size }) => <Ionicons name="sunny" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="pos"
        options={{
          title: "POS",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="kitchen"
        options={{
          title: "Kitchen",
          tabBarIcon: ({ color, size }) => <Ionicons name="flame" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="delivery"
        options={{
          title: "Delivery",
          tabBarIcon: ({ color, size }) => <Ionicons name="bicycle" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Inventory",
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkbox" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
