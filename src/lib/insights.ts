// Rule-based insight engine — recommendations computed from live org data.

import type {
  InventoryItem,
  InventoryTransaction,
  Order,
  SupplierItemPrice,
} from "@/lib/api/database.types";
import {
  recipeCost,
  marginPct,
  foodCostPct,
  unitsSold,
  popularityScores,
  type RecipeWithIngredients,
} from "@/lib/calc";
import { buildComparisons } from "@/lib/api/pricing";

export interface ComputedInsight {
  id: string;
  title: string;
  detail: string;
  impact: string;
  priority: "high" | "medium" | "low";
  module: string;
}

interface InsightInput {
  recipes: RecipeWithIngredients[];
  inventory: InventoryItem[];
  orders: Order[];
  transactions: InventoryTransaction[];
  targetFoodCostPct: number;
  fmt: (n: number, digits?: number) => string;
  supplierPrices?: SupplierItemPrice[];
}

const DAY_MS = 86400000;

export function computeInsights(input: InsightInput): ComputedInsight[] {
  const { recipes, inventory, orders, transactions, targetFoodCostPct, fmt, supplierPrices } = input;
  const out: ComputedInsight[] = [];
  const now = Date.now();
  const recent = (iso: string, days: number) => now - new Date(iso).getTime() < days * DAY_MS;

  // Daily sale usage per inventory item (last 7 days of sale transactions)
  const usage = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.reason !== "sale" || !tx.item_id || !recent(tx.created_at, 7)) continue;
    usage.set(tx.item_id, (usage.get(tx.item_id) ?? 0) + Math.abs(tx.delta));
  }

  // 1. Stockout forecasts — high priority
  for (const item of inventory) {
    const weekly = usage.get(item.id) ?? 0;
    const daily = weekly / 7;
    if (daily <= 0) continue;
    const daysLeft = item.stock / daily;
    if (daysLeft < 4) {
      const linkedRevenue = recipes
        .filter((r) => r.ingredients.some((i) => i.inventory_item_id === item.id))
        .reduce((s, r) => s + r.price, 0);
      out.push({
        id: `stockout-${item.id}`,
        title: `${item.name} runs out in ~${Math.max(1, Math.round(daysLeft))} day${daysLeft >= 1.5 ? "s" : ""}`,
        detail: `Selling through ${daily.toFixed(1)} ${item.unit}/day against ${item.stock} ${item.unit} on hand. Reorder now to protect the dishes that depend on it.`,
        impact: linkedRevenue > 0 ? `Protects ~${fmt(linkedRevenue * daily * 2)} sales` : "Avoid stockout",
        priority: "high",
        module: "Inventory",
      });
    }
  }

  // 2. Below-par items not already flagged
  const flagged = new Set(out.map((o) => o.id));
  const lowItems = inventory.filter(
    (i) => i.stock < i.par_level * 0.5 && !flagged.has(`stockout-${i.id}`),
  );
  if (lowItems.length > 0) {
    out.push({
      id: "low-stock-batch",
      title: `${lowItems.length} item${lowItems.length > 1 ? "s" : ""} below half par level`,
      detail: `${lowItems.slice(0, 3).map((i) => i.name).join(", ")}${lowItems.length > 3 ? ` and ${lowItems.length - 3} more` : ""} need restocking. Use one-click reorder in Inventory to draft the POs.`,
      impact: "One-click reorder ready",
      priority: "medium",
      module: "Procurement",
    });
  }

  // 3. Reprice candidates — food cost above target
  const sold = unitsSold(orders.filter((o) => recent(o.created_at, 14)));
  for (const r of recipes) {
    const fc = foodCostPct(r);
    if (fc > targetFoodCostPct + 6 && r.price > 0) {
      const targetPrice = recipeCost(r) / (targetFoodCostPct / 100);
      const delta = targetPrice - r.price;
      const units = sold.get(r.id) ?? 0;
      if (delta < 0.5) continue;
      out.push({
        id: `reprice-${r.id}`,
        title: `Reprice ${r.name}`,
        detail: `Food cost is ${fc.toFixed(0)}% against your ${targetFoodCostPct}% target. Raising the price ~${fmt(Math.ceil(delta))} (to ${fmt(Math.ceil(targetPrice))}) restores the margin.`,
        impact: units > 0 ? `+${fmt(Math.round(delta * units * 2))}/mo` : `+${fmt(Math.ceil(delta))}/plate`,
        priority: fc > targetFoodCostPct + 12 ? "high" : "medium",
        module: "Menu",
      });
    }
  }

  // 4. Hidden gems — high margin, low popularity
  const pop = popularityScores(recipes, orders.filter((o) => recent(o.created_at, 14)));
  for (const r of recipes) {
    const m = marginPct(r);
    const p = pop.get(r.id) ?? 0;
    if (m >= 72 && p > 0 && p < 40) {
      const profit = r.price - recipeCost(r);
      out.push({
        id: `promote-${r.id}`,
        title: `Promote ${r.name}`,
        detail: `${m.toFixed(0)}% margin but only ${p}% relative popularity. Feature it on specials or train servers to suggest it — every extra plate adds ${fmt(profit, 2)} profit.`,
        impact: `+${fmt(Math.round(profit * 30))}/mo at +1/day`,
        priority: "medium",
        module: "Sales",
      });
    }
  }

  // 5. Waste hotspot
  const wasteByCat = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.reason !== "waste" || !recent(tx.created_at, 14)) continue;
    const item = inventory.find((i) => i.id === tx.item_id);
    const value = Math.abs(tx.delta) * (item?.unit_cost ?? 0);
    const cat = item?.category ?? "Other";
    wasteByCat.set(cat, (wasteByCat.get(cat) ?? 0) + value);
  }
  const topWaste = [...wasteByCat.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topWaste && topWaste[1] > 30) {
    out.push({
      id: "waste-hotspot",
      title: `${topWaste[0]} waste is your costliest`,
      detail: `${fmt(topWaste[1])} of ${topWaste[0].toLowerCase()} written off in 14 days. Review prep batch sizes and FIFO rotation for this category.`,
      impact: `Recover up to ${fmt(Math.round(topWaste[1]))}/fortnight`,
      priority: topWaste[1] > 150 ? "high" : "medium",
      module: "Inventory",
    });
  }

  // 6. Dead stock — capital sitting still
  const dead = inventory.filter((i) => !usage.has(i.id) && i.stock > i.par_level && i.unit_cost * i.stock > 50);
  if (dead.length > 0) {
    const value = dead.reduce((s, i) => s + i.stock * i.unit_cost, 0);
    out.push({
      id: "dead-stock",
      title: `${fmt(value)} tied up in slow movers`,
      detail: `${dead.slice(0, 3).map((i) => i.name).join(", ")}${dead.length > 3 ? "…" : ""} haven't been used by any sale in 7 days yet sit above par. Run a special or trim the next order.`,
      impact: `Free ${fmt(Math.round(value * 0.4))} cash`,
      priority: "low",
      module: "Inventory",
    });
  }

  // 7. Peak-hour signal
  const hourRevenue = new Map<number, number>();
  for (const o of orders) {
    if (!recent(o.created_at, 14)) continue;
    const h = new Date(o.created_at).getHours();
    hourRevenue.set(h, (hourRevenue.get(h) ?? 0) + o.total);
  }
  const sortedHours = [...hourRevenue.entries()].sort((a, b) => b[1] - a[1]);
  if (sortedHours.length >= 3) {
    const [peakHour, peakRev] = sortedHours[0];
    const shoulder = hourRevenue.get(peakHour + 1) ?? 0;
    if (shoulder < peakRev * 0.45 && shoulder > 0) {
      out.push({
        id: "peak-shoulder",
        title: `Capture the ${peakHour + 1}:00 shoulder hour`,
        detail: `${peakHour}:00 is your peak (${fmt(peakRev)} over 2 weeks) but revenue drops ${Math.round((1 - shoulder / peakRev) * 100)}% the next hour. A timed promo or late-seating push can flatten the cliff.`,
        impact: `+${fmt(Math.round((peakRev * 0.25) * 2))}/mo potential`,
        priority: "low",
        module: "Sales",
      });
    }
  }

  // 8. Supplier price moves — increases and cheaper-vendor opportunities
  if (supplierPrices && supplierPrices.length) {
    for (const c of buildComparisons(supplierPrices)) {
      if (!c.latest) continue;
      const unitLabel = c.unit ? `/${c.unit}` : "";
      const perOrderSaving = c.saveVsBest * c.latest.pack_qty;
      if (c.changePct !== null && c.changePct >= 8 && c.prevForLatest) {
        out.push({
          id: `price-up-${c.key}`,
          title: `${c.item_name} up ${c.changePct.toFixed(0)}% from ${c.latest.vendor_name}`,
          detail: `Last paid ${fmt(c.latest.unitPrice, 2)}${unitLabel} vs ${fmt(c.prevForLatest, 2)}${unitLabel} before.${
            c.best && c.saveVsBest > 0 ? ` ${c.best.vendor_name} is cheaper at ${fmt(c.best.unitPrice, 2)}${unitLabel}.` : ""
          }`,
          impact: perOrderSaving > 0 ? `Save ${fmt(perOrderSaving)}/order` : "Watch margins",
          priority: c.changePct >= 15 ? "high" : "medium",
          module: "Procurement",
        });
      } else if (c.best && c.saveVsBest > 0 && perOrderSaving >= 5) {
        out.push({
          id: `cheaper-${c.key}`,
          title: `Cheaper ${c.item_name} at ${c.best.vendor_name}`,
          detail: `You last paid ${fmt(c.latest.unitPrice, 2)}${unitLabel} with ${c.latest.vendor_name}; ${c.best.vendor_name} offers ${fmt(c.best.unitPrice, 2)}${unitLabel}.`,
          impact: `Save ${fmt(perOrderSaving)}/order`,
          priority: "low",
          module: "Procurement",
        });
      }
    }
  }

  const weight = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => weight[a.priority] - weight[b.priority]);
}
