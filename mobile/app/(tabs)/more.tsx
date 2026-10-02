import { useState } from "react";
import { ScrollView, View, Text, Pressable, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Muted, Divider } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useScreens } from "@/lib/screens";
import { signOut } from "@/lib/api/session";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";

/** Everything that didn't fit in the tab bar, plus who you're signed in as and a way to sign out. */
export default function More() {
  const { ctx, isDemo, refresh } = useOrg();
  const router = useRouter();
  const { more } = useScreens();
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need your email and password to sign back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            await refresh();
          } catch (e) {
            Alert.alert("Couldn't sign out", errorMessage(e));
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-2">
        <Text className="text-2xl font-bold text-white">More</Text>

        {more.length > 0 ? (
          <Card className="p-0">
            {more.map((s, i) => (
              <View key={s.name}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => router.push(`/(tabs)/${s.name === "index" ? "" : s.name}` as never)}
                  className="flex-row items-center gap-3 p-4 active:opacity-70"
                >
                  <Ionicons name={s.icon} size={22} color={colors.brand300} />
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-white">{s.title}</Text>
                    <Muted>{s.blurb}</Muted>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.zinc500} />
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <Card className="gap-1">
          <Text className="text-base font-semibold text-white">{ctx?.me.name ?? "Signed in"}</Text>
          <Muted>
            {ctx?.me.role_title ?? ""}
            {ctx?.role ? ` · ${ctx.role}` : ""}
          </Muted>
          <Muted>{ctx?.org.name}</Muted>
          {isDemo ? <Muted>Demo mode — nothing here is real.</Muted> : null}
        </Card>

        {isDemo ? null : <Button title="Sign out" variant="danger" loading={signingOut} onPress={confirmSignOut} />}
      </ScrollView>
    </Screen>
  );
}
