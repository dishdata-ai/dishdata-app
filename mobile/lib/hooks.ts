import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { listTasks, setTaskStatus } from "@/lib/api/tasks";
import { getOpenShift, clockIn, clockOut, toggleBreak } from "@/lib/api/timeclock";
import { listMenu } from "@/lib/api/menu";
import {
  listOpenOrders,
  listKitchenOrders,
  createOrder,
  setKitchenStatus,
  type NewOrderInput,
} from "@/lib/api/orders";
import { listInventory, adjustStock } from "@/lib/api/inventory";
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

export function useCreateOrder() {
  const { orgId } = useIds();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewOrderInput) => createOrder(orgId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orders", orgId] });
      qc.invalidateQueries({ queryKey: ["kitchen", orgId] });
    },
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
