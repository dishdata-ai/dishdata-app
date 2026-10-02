import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { listTasks, setTaskStatus, patchTask, type DailyTaskPatch } from "@/lib/api/tasks";
import { listDuties } from "@/lib/api/duties";
import { listMyShifts } from "@/lib/api/shifts";
import {
  listMyAvailability,
  setAvailability,
  clearAvailability,
  type AvailabilityInput,
} from "@/lib/api/availability";
import { listUnclaimedEmployees, claimEmployee, setMyPin } from "@/lib/api/employees";
import { getStaffMealUsage, getPartnerMealUsage } from "@/lib/api/meals";
import {
  getOpenShift,
  clockIn,
  clockOut,
  toggleBreak,
  listMyTimeEntries,
  type ClockInGeo,
} from "@/lib/api/timeclock";
import { listMenu } from "@/lib/api/menu";
import { listEventMenus } from "@/lib/api/eventMenus";
import {
  listOpenOrders,
  listKitchenOrders,
  checkoutOrder,
  markOrderPaid,
  setKitchenStatus,
  type CheckoutPayload,
  type PaymentInput,
} from "@/lib/api/orders";
import { listCustomers } from "@/lib/api/customers";
import { listTables } from "@/lib/api/tables";
import { listInventory, adjustStock } from "@/lib/api/inventory";
import { listMyDeliveries, listOrgDeliveries, startTrip, reportLocation, markDelivered } from "@/lib/api/delivery";
import { listTiers, listEarnRules, listRewards, awardPoints, redeemReward } from "@/lib/api/loyalty";
import type { TaskStatus, KitchenStatus, TimeEntry, LoyaltyActionType } from "@/lib/types";

function useIds() {
  const { ctx } = useOrg();
  return { orgId: ctx?.org.id ?? "", empId: ctx?.me.id ?? "", enabled: Boolean(ctx) };
}

export function useTasks() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["tasks", orgId], queryFn: () => listTasks(orgId), enabled });
}

export function useDuties() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["duties", orgId], queryFn: () => listDuties(orgId), enabled });
}

/** Today's staff-meal allowance for the signed-in employee. Null when the server can't say. */
export function useStaffMealUsage(active: boolean) {
  const { orgId, empId, enabled } = useIds();
  return useQuery({
    queryKey: ["staffMealUsage", orgId, empId],
    queryFn: () => getStaffMealUsage(orgId, empId),
    enabled: enabled && active,
    retry: false,
  });
}

/** This month's free partner meals for the signed-in partner. Null when the server can't say. */
export function usePartnerMealUsage(active: boolean) {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["partnerMealUsage", orgId],
    queryFn: () => getPartnerMealUsage(orgId),
    enabled: enabled && active,
    retry: false,
  });
}

export function useMyTimeEntries() {
  const { orgId, empId, enabled } = useIds();
  return useQuery({
    queryKey: ["myTimeEntries", orgId, empId],
    queryFn: () => listMyTimeEntries(orgId, empId),
    enabled,
  });
}

export function useMyShifts() {
  const { orgId, empId, enabled } = useIds();
  return useQuery({ queryKey: ["myShifts", orgId, empId], queryFn: () => listMyShifts(orgId, empId), enabled });
}

export function useMyAvailability() {
  const { orgId, empId, enabled } = useIds();
  return useQuery({
    queryKey: ["myAvailability", orgId, empId],
    queryFn: () => listMyAvailability(orgId, empId),
    enabled,
  });
}

export function useAvailabilityMutations() {
  const { orgId, empId } = useIds();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["myAvailability", orgId, empId] });
  return {
    set: useMutation({
      mutationFn: (v: { day: string; input: AvailabilityInput }) => setAvailability(orgId, empId, v.day, v.input),
      onSuccess: invalidate,
    }),
    clear: useMutation({ mutationFn: (day: string) => clearAvailability(orgId, empId, day), onSuccess: invalidate }),
  };
}

/** Staff records still waiting to be claimed — for the "Who are you?" step. */
export function useUnclaimedEmployees(active: boolean) {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["unclaimedEmployees", orgId],
    queryFn: () => listUnclaimedEmployees(orgId),
    enabled: enabled && active,
  });
}

export function useClaimEmployee() {
  const { orgId } = useIds();
  return useMutation({ mutationFn: (employeeId: string) => claimEmployee(orgId, employeeId) });
}

export function useSetMyPin() {
  const { orgId } = useIds();
  return useMutation({ mutationFn: (pin: string) => setMyPin(orgId, pin) });
}

export function useShift() {
  const { orgId, empId, enabled } = useIds();
  return useQuery({
    queryKey: ["shift", orgId, empId],
    queryFn: () => getOpenShift(orgId, empId),
    enabled,
  });
}

export function useMenu() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["menu", orgId], queryFn: () => listMenu(orgId), enabled });
}

export function useEventMenus() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["event_menus", orgId],
    queryFn: () => listEventMenus(orgId),
    enabled,
  });
}

export function useOpenOrders() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["orders", orgId],
    queryFn: () => listOpenOrders(orgId),
    enabled,
  });
}

export function useKitchenOrders() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["kitchen", orgId],
    queryFn: () => listKitchenOrders(orgId),
    enabled,
    refetchInterval: 8000,
  });
}

export function useInventory() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["inventory", orgId],
    queryFn: () => listInventory(orgId),
    enabled,
  });
}

export function useCustomers() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["customers", orgId],
    queryFn: () => listCustomers(orgId),
    enabled,
  });
}

export function useTables() {
  const { orgId, enabled } = useIds();
  return useQuery({
    queryKey: ["tables", orgId],
    queryFn: () => listTables(orgId),
    enabled,
  });
}

export function useLoyaltyTiers() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["loyalty_tiers", orgId], queryFn: () => listTiers(orgId), enabled });
}

export function useLoyaltyEarnRules() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["loyalty_earn_rules", orgId], queryFn: () => listEarnRules(orgId), enabled });
}

export function useLoyaltyRewards() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["loyalty_rewards", orgId], queryFn: () => listRewards(orgId), enabled });
}

export function useAwardPoints() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, action }: { customerId: string; action: LoyaltyActionType }) =>
      awardPoints(orgId, customerId, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers", orgId] }),
  });
}

export function useRedeemReward() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, rewardId }: { customerId: string; rewardId: string }) =>
      redeemReward(orgId, customerId, rewardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customers", orgId] }),
  });
}

export function useMyDeliveries() {
  const { orgId, empId, enabled } = useIds();
  return useQuery({
    queryKey: ["my-deliveries", orgId, empId],
    queryFn: () => listMyDeliveries(orgId, empId),
    enabled,
    refetchInterval: 8000,
  });
}

/** Org-wide active deliveries — pass `enabled: false` when the caller isn't
 * owner/admin/manager (role-gating happens at the call site). */
export function useOrgDeliveries(enabled: boolean) {
  const { orgId, enabled: orgEnabled } = useIds();
  return useQuery({
    queryKey: ["org-deliveries", orgId],
    queryFn: () => listOrgDeliveries(orgId),
    enabled: orgEnabled && enabled,
    refetchInterval: 8000,
  });
}

// ---- mutations ----

export function useTaskMutations() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["tasks", orgId] });
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      setTaskStatus(orgId, id, status),
    onSuccess: invalidate,
  });
}

/** Tick a daily checklist item (or one of its steps). */
export function useDailyTaskMutation() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DailyTaskPatch }) => patchTask(orgId, id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", orgId] }),
  });
}

export function useShiftMutations() {
  const { orgId, empId } = useIds();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["shift", orgId, empId] });
  return {
    clockIn: useMutation({
      mutationFn: (geo?: ClockInGeo) => clockIn(orgId, empId, geo),
      onSuccess: invalidate,
    }),
    clockOut: useMutation({
      mutationFn: (entry: TimeEntry) => clockOut(orgId, entry),
      onSuccess: invalidate,
    }),
    toggleBreak: useMutation({
      mutationFn: (entry: TimeEntry) => toggleBreak(orgId, entry),
      onSuccess: invalidate,
    }),
  };
}

function useOrderInvalidate() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["orders", orgId] });
    qc.invalidateQueries({ queryKey: ["kitchen", orgId] });
    qc.invalidateQueries({ queryKey: ["inventory", orgId] });
    qc.invalidateQueries({ queryKey: ["customers", orgId] });
    qc.invalidateQueries({ queryKey: ["tables", orgId] });
  };
}

export function useCheckout() {
  const { orgId } = useIds();
  const invalidate = useOrderInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CheckoutPayload) => checkoutOrder(orgId, payload),
    onSuccess: () => {
      invalidate();
      // A meal claim just spent some allowance — drop the cached balances so the next claim (and My Day) read
      // the real remainder, not the pre-sale figure.
      qc.invalidateQueries({ queryKey: ["staffMealUsage", orgId] });
      qc.invalidateQueries({ queryKey: ["partnerMealUsage", orgId] });
    },
  });
}

export function useSettle() {
  const { orgId } = useIds();
  const invalidate = useOrderInvalidate();
  return useMutation({
    mutationFn: (vars: { orderId: string; payments: PaymentInput[]; tip: number }) =>
      markOrderPaid(orgId, vars.orderId, vars.payments, vars.tip),
    onSuccess: invalidate,
  });
}

export function useKitchenMutation() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: KitchenStatus }) =>
      setKitchenStatus(orgId, id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kitchen", orgId] }),
  });
}

export function useDeliveryMutations() {
  const { orgId, empId } = useIds();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["my-deliveries", orgId, empId] });
  return {
    startTrip: useMutation({
      mutationFn: (deliveryId: string) => startTrip(orgId, deliveryId),
      onSuccess: invalidate,
    }),
    // No invalidate here — this fires every ~15s while a trip is active and
    // only updates lat/lng, not anything the deliveries list needs to refetch.
    reportLocation: useMutation({
      mutationFn: (vars: { deliveryId: string; lat: number; lng: number }) =>
        reportLocation(vars.deliveryId, vars.lat, vars.lng),
    }),
    markDelivered: useMutation({
      mutationFn: (deliveryId: string) => markDelivered(orgId, deliveryId),
      onSuccess: invalidate,
    }),
  };
}

export function useStockAdjust() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      delta,
      reason,
    }: {
      itemId: string;
      delta: number;
      reason: "waste" | "count" | "adjustment";
    }) => adjustStock(orgId, itemId, delta, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventory", orgId] }),
  });
}
