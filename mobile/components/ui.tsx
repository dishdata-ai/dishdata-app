import { ReactNode, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  TextInput,
  type PressableProps,
  type TextInputProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.base }}>
      <View className={`flex-1 px-4 ${className ?? ""}`}>{children}</View>
    </SafeAreaView>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <View className={`rounded-2xl border border-line bg-surface p-4 ${className ?? ""}`}>
      {children}
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text className="text-2xl font-bold text-white">{children}</Text>;
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <Text className={`text-sm text-zinc-400 ${className ?? ""}`}>{children}</Text>;
}

type Tone = "brand" | "green" | "amber" | "rose" | "violet" | "neutral" | "accent";

const toneText: Record<Tone, string> = {
  brand: "text-brand-300",
  green: "text-brand-400",
  amber: "text-amber-soft",
  rose: "text-rose-soft",
  violet: "text-violet-soft",
  accent: "text-accent-400",
  neutral: "text-zinc-400",
};
const toneBg: Record<Tone, string> = {
  brand: "bg-brand-500/15 border-brand-500/30",
  green: "bg-brand-400/15 border-brand-400/30",
  amber: "bg-amber-soft/15 border-amber-soft/30",
  rose: "bg-rose-soft/15 border-rose-soft/30",
  violet: "bg-violet-soft/15 border-violet-soft/30",
  accent: "bg-accent-400/15 border-accent-400/30",
  neutral: "bg-white/5 border-line",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <View className={`self-start rounded-full border px-2.5 py-1 ${toneBg[tone]}`}>
      <Text className={`text-xs font-semibold ${toneText[tone]}`}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  className,
}: {
  title: string;
  onPress?: PressableProps["onPress"];
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "flex-row items-center justify-center gap-2 rounded-xl px-4 py-3.5 active:opacity-80";
  const styles =
    variant === "primary"
      ? "bg-brand-500"
      : variant === "danger"
        ? "bg-rose-soft/15 border border-rose-soft/30"
        : "border border-line bg-white/5";
  const textStyle =
    variant === "primary"
      ? "text-base font-bold text-black"
      : variant === "danger"
        ? "text-base font-semibold text-rose-soft"
        : "text-base font-semibold text-white";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`${base} ${styles} ${disabled ? "opacity-40" : ""} ${className ?? ""}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#000" : colors.white} />
      ) : (
        <Text className={textStyle}>{title}</Text>
      )}
    </Pressable>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "brand",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card className="flex-1">
      <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</Text>
      <Text className={`mt-1 text-2xl font-bold ${toneText[tone]}`}>{value}</Text>
      {hint ? <Text className="mt-0.5 text-xs text-zinc-500">{hint}</Text> : null}
    </Card>
  );
}

export function Divider() {
  return <View className="h-px bg-line" />;
}

export interface PickerOption {
  label: string;
  value: string;
}

/** A select-style field: shows the current label, opens a modal list on tap. */
export function Picker({
  value,
  options,
  onChange,
  placeholder = "Select…",
  title,
}: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl border border-line bg-white/5 px-4 py-3"
      >
        <Text className={current ? "text-white" : "text-zinc-500"} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.zinc500} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setOpen(false)}>
          <Pressable className="rounded-t-3xl border-t border-line bg-surface p-4 pb-8">
            {title ? <Text className="mb-2 px-1 text-base font-bold text-white">{title}</Text> : null}
            <ScrollView className="max-h-96">
              {options.map((o) => {
                const active = o.value === value;
                return (
                  <Pressable
                    key={o.value || "__none"}
                    onPress={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex-row items-center justify-between rounded-xl px-4 py-3 ${
                      active ? "bg-brand-500/15" : ""
                    }`}
                  >
                    <Text className={active ? "font-semibold text-brand-300" : "text-zinc-200"}>
                      {o.label}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={colors.brand400} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function Input({ className, ...rest }: TextInputProps & { className?: string }) {
  return (
    <TextInput
      placeholderTextColor={colors.zinc500}
      className={`rounded-xl border border-line bg-white/5 px-4 py-3 text-white ${className ?? ""}`}
      {...rest}
    />
  );
}
