import { useState } from "react";
import { View, Text, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Screen, Button, Badge, Muted } from "@/components/ui";
import { signIn } from "@/lib/api/session";
import { useOrg } from "@/lib/org-context";
import { colors } from "@/lib/theme";

export default function SignIn() {
  const router = useRouter();
  const { isDemo, refresh } = useOrg();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    try {
      setBusy(true);
      setError(null);
      await signIn(email.trim(), password);
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const enterDemo = async () => {
    await refresh();
    router.replace("/");
  };

  return (
    <Screen className="justify-center">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="mb-8 items-center">
          <View
            className="mb-4 h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: colors.brand500 }}
          >
            <Text className="text-3xl">◎</Text>
          </View>
          <Text className="text-3xl font-bold text-white">
            Dish<Text style={{ color: colors.accent400 }}>Data</Text>
          </Text>
          <Muted className="mt-1">AI restaurant intelligence, in your pocket</Muted>
        </View>

        {isDemo ? (
          <View className="items-center gap-4">
            <Badge tone="amber">Demo mode — no backend configured</Badge>
            <Muted className="text-center">
              Explore the full staff experience with seeded sample data. Add Supabase keys to
              connect a real restaurant.
            </Muted>
            <Button title="Enter demo workspace" onPress={enterDemo} className="w-full" />
          </View>
        ) : (
          <View className="gap-3">
            <View>
              <Text className="mb-1.5 text-sm font-semibold text-zinc-300">Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@restaurant.com"
                placeholderTextColor={colors.zinc500}
                autoCapitalize="none"
                keyboardType="email-address"
                className="rounded-xl border border-line bg-surface px-4 py-3.5 text-white"
              />
            </View>
            <View>
              <Text className="mb-1.5 text-sm font-semibold text-zinc-300">Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={colors.zinc500}
                secureTextEntry
                className="rounded-xl border border-line bg-surface px-4 py-3.5 text-white"
              />
            </View>
            {error ? <Text className="text-sm text-rose-soft">{error}</Text> : null}
            <Button title="Sign in" onPress={onSignIn} loading={busy} className="mt-2" />
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
