import "../global.css";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { OrgProvider } from "@/lib/org-context";
import { colors } from "@/lib/theme";

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            // Event Wi-Fi is unreliable — retry a few times with backoff so a
            // transient failure doesn't leave the menu blank until a restart.
            retry: 4,
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
            // Show cached data and keep retrying when the network drops, rather
            // than erroring to an empty screen.
            networkMode: "offlineFirst",
            // Refetch when the app returns to the foreground (wired below).
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  // React Query's "focus" on native has to be driven from AppState — without
  // this, foregrounding the app never refetches and stale/empty data lingers.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => sub.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <OrgProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.base },
                headerTintColor: colors.white,
                contentStyle: { backgroundColor: colors.base },
                headerShadowVisible: false,
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="sign-in" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
          </OrgProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
