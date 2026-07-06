import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { listTasks, setTaskStatus } from "@/lib/api/tasks";
import { getOpenShift, clockIn, clockOut, toggleBreak } from "@/lib/api/timeclock";
import { listMenu } from "@/lib/api/menu";
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
import type { TaskStatus, KitchenStatus, TimeEntry } from "@/lib/types";

function useIds() {
  const { ctx } = useOrg();
  return { orgId: ctx?.org.id ?? "", empId: ctx?.me.id ?? "", enabled: Boolean(ctx) };
}

export function useTasks() {
  const { orgId, enabled } = useIds();
  return useQuery({ queryKey: ["tasks", orgId], queryFn: () => listTasks(orgId), enabled });
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

export function useShiftMutations() {
  const { orgId, empId } = useIds();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["shift", orgId, empId] });
  return {
    clockIn: useMutation({ mutationFn: () => clockIn(orgId, empId), onSuccess: invalidate }),
    clockOut: useMutation({
      mutationFn: (entryId: string) => clockOut(orgId, entryId),
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
  return useMutation({
    mutationFn: (payload: CheckoutPayload) => checkoutOrder(orgId, payload),
    onSuccess: invalidate,
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
