"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useKitchenDishes, useKitchenLog, useRecipes, useEmployees, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateKitchenDish, logKitchen, type DishPatch } from "@/lib/api/kitchen";
import { listKitchenOrders } from "@/lib/api/orders";
import { buildDemand, liveRows, waitingByDish, OPEN_HOUR, LAST_HOUR, nextServiceDay } from "@/lib/kitchen-ops";
import { recipeCost } from "@/lib/calc";
import { toast } from "@/lib/toast";
import type { KitchenDish } from "@/lib/api/database.types";

/** Everything the Kitchen Ops tabs share: data, the demand model, live rows and the count actions. */
export function useKitchenOps(multiplier: number) {
  const { org, isManager } = useOrg();
  const { user } = useAuth();
  // Key extends ["org", id, "orders"] so invalidate("orders") after a ticket update refreshes this too.
  const ordersQ = useQuery({
    queryKey: ["org", org?.id, "orders", "kitchen"],
    queryFn: () => listKitchenOrders(org!.id),
    enabled: !!org,
  });
  const dishesQ = useKitchenDishes();
  const logQ = useKitchenLog();
  const recipesQ = useRecipes();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  const qc = useQueryClient();

  // Re-evaluate "now" every 30 s so statuses and waiting times stay current.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  // Pick up counts that other people change on other screens. Orders refresh through realtime instead —
  // re-downloading 90 days of them every 30 s would be wasteful.
  useEffect(() => {
    const t = setInterval(() => invalidate("kitchen_dishes"), 30_000);
    return () => clearInterval(t);
  }, [invalidate]);
  useRealtimeInvalidate("orders", ["orders"]);

  const orders = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);
  const dishes = useMemo(() => dishesQ.data ?? [], [dishesQ.data]);
  const log = useMemo(() => logQ.data ?? [], [logQ.data]);

  const model = useMemo(() => buildDemand(orders, dishes, now), [orders, dishes, now]);
  const waiting = useMemo(() => waitingByDish(orders, dishes, now.getTime()), [orders, dishes, now]);
  const rows = useMemo(() => liveRows(model, dishes, waiting, now, multiplier), [model, dishes, waiting, now, multiplier]);

  const me = (employeesQ.data ?? []).find((e) => e.user_id === user?.id)?.name ?? user?.email ?? null;

  /** Menu price and food cost per portion for a component (from its linked or same-named recipe). */
  const money = useMemo(() => {
    const byName = new Map((recipesQ.data ?? []).map((r) => [r.name.toLowerCase(), r]));
    const byId = new Map((recipesQ.data ?? []).map((r) => [r.id, r]));
    return (d: KitchenDish) => {
      const r = (d.recipe_id && byId.get(d.recipe_id)) || byName.get(d.dish.toLowerCase());
      return r ? { price: r.price as number, cost: recipeCost(r) as number } : { price: null, cost: null };
    };
  }, [recipesQ.data]);

  const key = ["org", org?.id, "kitchen_dishes"];
  const inService = now.getHours() >= OPEN_HOUR && now.getHours() <= LAST_HOUR;

  /** Change the live hot / fridge count. Updates the screen at once so quick taps stack, saves in the background. */
  const adjust = (dish: KitchenDish, field: "hot_portions" | "fridge_portions", delta: number) => {
    const next = Math.max(0, dish[field] + delta);
    if (next === dish[field]) return;
    const patch: DishPatch = { [field]: next, updated_by: me };
    qc.setQueryData<KitchenDish[]>(key, (old) => old?.map((d) => (d.id === dish.id ? { ...d, ...patch, updated_at: new Date().toISOString() } : d)));
    updateKitchenDish(org!.id, dish.id, patch).catch((e) => {
      toast.error("Could not save count", e instanceof Error ? e.message : "");
      invalidate("kitchen_dishes");
    });
    const before = dish.hot_portions + dish.fridge_portions;
    const after = before - dish[field] + next;
    if (before > 0 && after === 0 && inService) {
      logKitchen(org!.id, { dish: dish.dish, kind: "stockout", portions: 0, by: me }).then(() => invalidate("kitchen_log"));
    }
  };

  /** Record freshly cooked portions: adds to the hot count and to the log. */
  const cooked = (dish: KitchenDish, n: number) => {
    if (n <= 0) return;
    adjust(dish, "hot_portions", n);
    logKitchen(org!.id, { dish: dish.dish, kind: "cooked", portions: n, by: me }).then(() => invalidate("kitchen_log"));
  };

  return {
    org, isManager, now, orders, dishes, log, model, waiting, rows, money, me, adjust, cooked, inService,
    loading: dishesQ.isLoading || ordersQ.isLoading,
    defaultDay: now.getDay() === 1 ? nextServiceDay(now) : now.getDay(),
  };
}

export type KitchenOpsCtx = ReturnType<typeof useKitchenOps>;
