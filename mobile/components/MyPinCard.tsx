import { useState } from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card, Badge, Button, Input, Muted } from "@/components/ui";
import { useOrg } from "@/lib/org-context";
import { useSetMyPin } from "@/lib/hooks";
import { errorMessage } from "@/lib/errors";
import { colors } from "@/lib/theme";

/** Your own PIN: confirms it's really you when you claim a staff meal, and approves a big discount at the till. */
export default function MyPinCard({ hasPin }: { hasPin: boolean }) {
  const { refresh } = useOrg();
  const save = useSetMyPin();
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pin.trim().length < 4) {
      setError("PIN needs to be at least 4 digits.");
      return;
    }
    setError(null);
    try {
      await save.mutateAsync(pin);
      await refresh(); // pulls your updated record so the badge flips to "Set"
      setEditing(false);
      setPin("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <View className="rounded-xl bg-white/5 p-2">
          <Ionicons name="key-outline" size={18} color={colors.accent400} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold text-white">My PIN</Text>
          <Muted>Used to claim a staff meal or approve a discount at the till.</Muted>
        </View>
        <Badge tone={hasPin ? "green" : "amber"}>{hasPin ? "Set" : "Not set"}</Badge>
      </View>

      {editing ? (
        <View className="mt-3 gap-2">
          <Input
            placeholder="New PIN (4–8 digits)"
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, ""))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
            autoFocus
          />
          {error ? <Text className="text-sm font-semibold text-rose-soft">{error}</Text> : null}
          <View className="flex-row gap-2">
            <Button title="Save" className="flex-1" loading={save.isPending} onPress={submit} />
            <Button
              title="Cancel"
              variant="ghost"
              className="flex-1"
              onPress={() => {
                setEditing(false);
                setPin("");
                setError(null);
              }}
            />
          </View>
        </View>
      ) : (
        <View className="mt-3">
          <Button title={hasPin ? "Change PIN" : "Set a PIN"} variant="ghost" onPress={() => setEditing(true)} />
        </View>
      )}
    </Card>
  );
}
