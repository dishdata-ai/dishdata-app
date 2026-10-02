import { useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Badge, StatTile, Muted, Divider } from "@/components/ui";
import ClaimEmployee from "@/components/ClaimEmployee";
import MyPinCard from "@/components/MyPinCard";
import MyShifts from "@/components/MyShifts";
import { useOrg } from "@/lib/org-context";
import { hasModule } from "@/lib/api/session";
import {
  useShift,
  useShiftMutations,
  useTasks,
  useTaskMutations,
  useOrgDeliveries,
  useStaffMealUsage,
  usePartnerMealUsage,
  useDuties,
  useMyAvailability,
  useKitchenOrders,
} from "@/lib/hooks";
import { myDuties } from "@/lib/duties";
import { dayKey, weekDays } from "@/lib/dates";
import { distanceMeters, geofenceOf, getCurrentPosition } from "@/lib/geo";
import { errorMessage } from "@/lib/errors";
import { elapsed, clockTime, money } from "@/lib/format";
import { PARTNER_ROLES } from "@/lib/staff-meal";
import { colors } from "@/lib/theme";
import type { DeliveryStatus } from "@/lib/types";

const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
// Pay and hours are for owners and admins only — regular staff don't see them on My Day (same as the website).
const PAY_ROLES = new Set(["owner", "admin"]);

const DELIVERY_STATUS_TONE: Record<DeliveryStatus, "neutral" | "amber" | "green" | "accent" | "rose"> = {
  pending: "neutral",
  assigned: "amber",
  picked_up: "accent",
  delivered: "green",
  failed: "rose",
};

export default function MyDay() {
  const { ctx, isDemo } = useOrg();
  const router = useRouter();
  const me = ctx?.me;
  const isManager = Boolean(ctx?.role && MANAGER_ROLES.has(ctx.role));
  const canSeePay = Boolean(ctx?.role && PAY_ROLES.has(ctx.role));
  // A login with no staff record gets a stand-in whose id is the user's own id; the database has no such employee.
  const linked = isDemo || (!!me && me.user_id != null && me.id !== me.user_id);
  const shiftQ = useShift();
  const { clockIn, clockOut, toggleBreak } = useShiftMutations();
  const tasksQ = useTasks();
  const taskMut = useTaskMutations();
  const orgDeliveriesQ = useOrgDeliveries(isManager);
  const dutiesQ = useDuties();
  const availabilityQ = useMyAvailability();
  const kitchenQ = useKitchenOrders();

  // Clock-in: if the restaurant set a location, check you're there first, then clock in through the secured function.
  const geofence = ctx ? geofenceOf(ctx.org) : null;
  const [clockBusy, setClockBusy] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);
  const onClockIn = async () => {
    setClockError(null);
    setClockBusy(true);
    try {
      if (geofence) {
        const pos = await getCurrentPosition();
        const distanceM = distanceMeters(pos, geofence);
        if (distanceM > geofence.radiusM) {
          setClockError(`You're not at the restaurant — ${Math.round(distanceM)}m away. Ask a manager to clock you in.`);
          return;
        }
        await clockIn.mutateAsync({ lat: pos.lat, lng: pos.lng, distanceM });
      } else {
        await clockIn.mutateAsync(undefined);
      }
    } catch (e) {
      setClockError(errorMessage(e, "Clock-in failed — please try again."));
    } finally {
      setClockBusy(false);
    }
  };
  const shiftActionError = clockOut.error ?? toggleBreak.error;

  // Meal allowances. The staff one shows for everyone once the restaurant has switched it on; partner meals only
  // ever show to partners. Both quietly disappear if the database can't answer (e.g. before migration 0070).
  const staffMealOn = (ctx?.org.staff_meal_daily_limit ?? 0) > 0;
  const partnerMealOn = Boolean(ctx?.role && PARTNER_ROLES.has(ctx.role)) && (ctx?.org.partner_meal_monthly_count ?? 0) > 0;
  const staffMeal = useStaffMealUsage(staffMealOn).data ?? null;
  const partnerMeal = usePartnerMealUsage(partnerMealOn).data ?? null;

  const shift = shiftQ.data ?? null;
  const onBreak = Boolean(shift?.break_started_at);
  const tasks = tasksQ.data ?? [];
  const myTasks = tasks.filter((t) => t.assignee_employee_id === me?.id);
  const openTasks = myTasks.filter((t) => t.status !== "done");
  const holdsDuty = myDuties(dutiesQ.data ?? [], me ?? null, me?.user_id ?? undefined).size > 0;
  const nextWeekFilled = weekDays(1).filter((d) =>
    (availabilityQ.data ?? []).some((r) => r.day === dayKey(d)),
  ).length;
  const kitchenOpen = (kitchenQ.data ?? []).length;

  // Earnings estimate from elapsed worked minutes (minus banked break seconds).
  const workedMs = shift
    ? Date.now() - new Date(shift.clock_in).getTime() - shift.break_seconds * 1000
    : 0;
  const workedHrs = Math.max(0, workedMs / 3_600_000);
  const earnings = workedHrs * (me?.hourly_rate ?? 0);

  if (!linked) {
    return (
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-2">
          <Text className="text-2xl font-bold text-white">My Day</Text>
          <ClaimEmployee />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} className="flex-1" contentContainerClassName="gap-4 pb-6 pt-2">
        <View>
          <Text className="text-2xl font-bold text-white">
            Hi {me?.name?.split(" ")[0] ?? "there"} 👋
          </Text>
          <Muted>{me?.role_title ?? "Team member"} · {ctx?.org.name}</Muted>
        </View>

        {/* Shift card */}
        <Card>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Ionicons
                name={shift ? "radio-button-on" : "radio-button-off"}
                size={18}
                color={shift ? colors.brand400 : colors.zinc500}
              />
              <Text className="text-base font-semibold text-white">
                {shift ? (onBreak ? "On break" : "On shift") : "Off the clock"}
              </Text>
            </View>
            {shift ? (
              <Badge tone={onBreak ? "amber" : "green"}>
                {onBreak ? "Break" : `${elapsed(shift.clock_in)} worked`}
              </Badge>
            ) : null}
          </View>

          {shift ? (
            <>
              <Muted className="mt-1">
                Clocked in at {clockTime(shift.clock_in)}
                {me?.shift_note ? ` · ${me.shift_note}` : ""}
              </Muted>
              <View className="mt-4 flex-row gap-3">
                <Button
                  title={onBreak ? "End break" : "Start break"}
                  variant="ghost"
                  className="flex-1"
                  loading={toggleBreak.isPending}
                  onPress={() => toggleBreak.mutate(shift)}
                />
                <Button
                  title="Clock out"
                  variant="danger"
                  className="flex-1"
                  loading={clockOut.isPending}
                  onPress={() => clockOut.mutate(shift)}
                />
              </View>
            </>
          ) : (
            <View className="mt-4">
              <Button title="Clock in" loading={clockBusy} onPress={onClockIn} />
              {geofence ? (
                <Muted className="mt-1.5 text-center">Checks you&apos;re at the restaurant</Muted>
              ) : null}
            </View>
          )}
          {clockError ? <Text className="mt-3 text-sm font-semibold text-rose-soft">{clockError}</Text> : null}
          {shiftActionError ? (
            <Text className="mt-3 text-sm font-semibold text-rose-soft">{errorMessage(shiftActionError)}</Text>
          ) : null}
        </Card>

        {/* Stats */}
        <View className="flex-row gap-3">
          {canSeePay ? (
            <>
              <StatTile label="Hours today" value={workedHrs.toFixed(1)} hint="incl. current shift" />
              <StatTile
                label="Est. earnings"
                value={money(earnings)}
                hint={`@ ${money(me?.hourly_rate ?? 0)}/hr`}
                tone="accent"
              />
            </>
          ) : null}
          <StatTile label="Open tasks" value={String(openTasks.length)} hint="assigned to you" tone="violet" />
        </View>

        {/* Next week's availability */}
        <Pressable onPress={() => router.push("/availability")} className="active:opacity-80">
          <Card className="flex-row items-center gap-3">
            <Ionicons name="calendar-outline" size={22} color={colors.accent400} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-white">My availability</Text>
              <Muted>
                {nextWeekFilled === 7
                  ? "Next week is all filled in"
                  : `Next week: ${nextWeekFilled}/7 days — tell your manager when you can work`}
              </Muted>
            </View>
            <Badge tone={nextWeekFilled === 7 ? "green" : "amber"}>{nextWeekFilled}/7</Badge>
            <Ionicons name="chevron-forward" size={18} color={colors.zinc500} />
          </Card>
        </Pressable>

        {/* Meal allowances */}
        {(staffMealOn && staffMeal) || (partnerMealOn && partnerMeal?.eligible) ? (
          <View className="flex-row gap-3">
            {staffMealOn && staffMeal ? (
              staffMeal.working_today === false ? (
                <StatTile
                  label="Staff meals"
                  value={`${staffMeal.pct ?? 0}% off`}
                  hint={`Clock in to get your free ${money(staffMeal.limit ?? 0)}`}
                />
              ) : (
                <StatTile
                  label="Meal allowance"
                  value={money(staffMeal.remaining)}
                  hint={
                    staffMeal.drinks_remaining != null
                      ? `left today · ${staffMeal.drinks_remaining} free drink${staffMeal.drinks_remaining === 1 ? "" : "s"}`
                      : "left today"
                  }
                />
              )
            ) : null}
            {partnerMealOn && partnerMeal?.eligible ? (
              <StatTile
                label="Partner meals"
                value={`${partnerMeal.remaining} of ${partnerMeal.count ?? 0}`}
                hint="free, left this month"
                tone="accent"
              />
            ) : null}
          </View>
        ) : null}

        <MyShifts />

        <MyPinCard hasPin={Boolean(me?.pin)} />

        {/* Daily checklist for the duties I hold */}
        {holdsDuty && hasModule(ctx, "dailytasks") ? (
          <Pressable
            onPress={() => router.push({ pathname: "/tasks", params: { view: "daily" } })}
            className="active:opacity-80"
          >
            <Card className="flex-row items-center gap-3">
              <Ionicons name="checkmark-done-circle-outline" size={24} color={colors.brand300} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-white">Today&apos;s checklist</Text>
                <Muted>The daily tasks for your duties</Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.zinc500} />
            </Card>
          </Pressable>
        ) : null}

        {/* Today's tasks */}
        <View>
          <Text className="mb-2 text-lg font-bold text-white">Your tasks</Text>
          <Card className="p-0">
            {myTasks.length === 0 ? (
              <View className="p-6">
                <Muted className="text-center">No tasks assigned. Enjoy the calm. 🌿</Muted>
              </View>
            ) : (
              myTasks.map((t, i) => (
                <View key={t.id}>
                  {i > 0 ? <Divider /> : null}
                  <View className="flex-row items-center gap-3 p-4">
                    <Ionicons
                      name={t.status === "done" ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={t.status === "done" ? colors.brand400 : colors.zinc500}
                      onPress={() =>
                        taskMut.mutate({
                          id: t.id,
                          status: t.status === "done" ? "todo" : "done",
                        })
                      }
                    />
                    <View className="flex-1">
                      <Text
                        className={`text-base ${
                          t.status === "done" ? "text-zinc-500 line-through" : "text-white"
                        }`}
                      >
                        {t.title}
                      </Text>
                    </View>
                    {t.priority === "high" && t.status !== "done" ? (
                      <Badge tone="rose">High</Badge>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </Card>
        </View>

        {/* Today at the restaurant */}
        {hasModule(ctx, "kitchen") ? (
          <Pressable onPress={() => router.push("/kitchen")} className="active:opacity-80">
            <Card className="flex-row items-center gap-3">
              <Ionicons name="flame-outline" size={24} color={colors.brand300} />
              <View className="flex-1">
                <Text className="text-base font-semibold text-white">Kitchen queue</Text>
                <Muted>
                  {kitchenOpen === 0 ? "Line is clear" : `${kitchenOpen} open ticket${kitchenOpen > 1 ? "s" : ""}`}
                </Muted>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.zinc500} />
            </Card>
          </Pressable>
        ) : null}

        {/* Manager view — all active deliveries org-wide, not just your own */}
        {isManager ? (
          <View>
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-white">Active deliveries</Text>
              <Badge tone="accent">{orgDeliveriesQ.data?.length ?? 0} in progress</Badge>
            </View>
            <Card className="p-0">
              {(orgDeliveriesQ.data?.length ?? 0) === 0 ? (
                <View className="p-6">
                  <Muted className="text-center">No deliveries in progress right now.</Muted>
                </View>
              ) : (
                orgDeliveriesQ.data!.map((d, i) => (
                  <View key={d.id}>
                    {i > 0 ? <Divider /> : null}
                    <View className="p-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-base font-semibold text-white">
                          {d.order?.guest_name ?? "Guest"}
                        </Text>
                        <Badge tone={DELIVERY_STATUS_TONE[d.status]}>
                          {d.status.replace("_", " ")}
                        </Badge>
                      </View>
                      <Muted className="mt-0.5">{d.address}</Muted>
                      <View className="mt-1.5 flex-row items-center justify-between">
                        <Muted>{d.courier ? `Rider: ${d.courier.name}` : "Unassigned"}</Muted>
                        {d.order ? (
                          <Text className="text-sm font-semibold text-brand-300">
                            {money(d.order.total)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
