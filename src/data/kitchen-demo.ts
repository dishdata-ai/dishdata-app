// Demo data for Kitchen Ops: the production plan plus ~4 weeks of Kerala order history whose
// weekday and hourly shape follows Kokoland's real 26 Aug – 19 Sep 2026 sales (aggregates only).

import { uid } from "@/lib/utils";
import { KITCHEN_STANDARDS } from "@/data/kitchen-standards";
import { newDishRow } from "@/lib/api/kitchen";
import type { KitchenDish, Order } from "@/lib/api/database.types";

/** Average portions per service day, Tue Wed Thu Fri Sat Sun (from the sales export). */
const WEEKDAY_AVG: Record<string, number[]> = {
  Porotta: [16.4, 10.83, 20.5, 20.17, 26.67, 17.6],
  "Chicken Curry": [4.8, 4.33, 3.83, 4.5, 8.33, 5.6],
  Puttu: [4.4, 2, 4.67, 3.5, 8, 4.4],
  "Beef Roast": [5, 1.5, 2.67, 6, 5.83, 3.2],
  "Chicken Biriyani": [4.4, 2.33, 2.67, 2.5, 4.17, 3.6],
  "Gobi Manchurian": [3.2, 1.83, 1.33, 3.17, 3.83, 3.2],
  "Beef Curry": [3.2, 0.33, 2.83, 1.5, 4.83, 2.4],
  "Beef Fry / Dry Fry": [2.8, 1.83, 3, 1, 4.17, 0],
  "Kadala Curry": [0.4, 0, 1, 1.83, 5, 1.6],
  "Paneer Butter Masala": [2, 2, 2.83, 2.33, 0.67, 0],
  "Veg Kurma": [0, 0.33, 2.67, 1.33, 3.67, 1.2],
  Pazhampori: [0, 0, 1.33, 1, 6, 0.4],
  "Chicken Cutlet": [2.6, 0.33, 1, 1, 1, 2.4],
  "Chicken 65": [2.6, 0.33, 0.67, 0.83, 2, 0.8],
  "Onion Pakoda": [0.8, 1, 2.33, 1.33, 0.5, 0.8],
  "Paneer Biriyani": [1.6, 0.67, 1.67, 0.5, 0.67, 0.4],
  Rice: [0, 0, 0, 2.17, 1.83, 1.2],
  "Paneer Chilli": [0.4, 0.67, 0.83, 1.67, 0.67, 0],
  Salad: [0.4, 0, 0.67, 0.5, 1.5, 0],
  Dessert: [0.4, 0, 0.67, 0, 1.33, 0.4],
};

/** Relative demand by hour 11..22 (from the sales export: quiet lunch, busy 18:00–22:00, peak at 21:00). */
const HOUR_WEIGHT = [0, 0.5, 2.82, 3.35, 4.88, 3.44, 2.94, 5.44, 7.94, 7.29, 14.47, 4.88];
const WD_INDEX: Record<number, number> = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 0: 5 };

let seed = 20260920;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

export function buildKitchenDishes(orgId: string): KitchenDish[] {
  return KITCHEN_STANDARDS.map((s, i) => {
    const hot = s.frozen ? (s.dish === "Porotta" ? 0 : 0) : Math.max(0, s.reorder_at + Math.floor(rnd() * 3));
    const store = s.frozen ? 6 + Math.floor(rnd() * 20) : Math.floor(rnd() * 3);
    return { id: uid(), ...newDishRow(orgId, s, i + 1), hot_portions: hot, fridge_portions: store };
  });
}

export function buildKeralaOrders(orgId: string, days = 28): Order[] {
  const orders: Order[] = [];
  let n = 1;
  for (let back = days; back >= 1; back--) {
    const date = new Date();
    date.setDate(date.getDate() - back);
    const wd = date.getDay();
    if (wd === 1) continue; // Monday closed
    const col = WD_INDEX[wd];
    // portions[hourIndex] = [dish names...]
    const perHour: string[][] = HOUR_WEIGHT.map(() => []);
    const totalWeight = HOUR_WEIGHT.reduce((a, b) => a + b, 0);
    for (const [dish, avgs] of Object.entries(WEEKDAY_AVG)) {
      const avg = avgs[col];
      const count = Math.max(0, Math.round(avg * (0.75 + rnd() * 0.5)));
      for (let c = 0; c < count; c++) {
        let r = rnd() * totalWeight;
        let h = 0;
        while (h < HOUR_WEIGHT.length - 1 && r > HOUR_WEIGHT[h]) (r -= HOUR_WEIGHT[h]), h++;
        perHour[h].push(dish);
      }
    }
    perHour.forEach((dishes, hi) => {
      while (dishes.length) {
        const take = dishes.splice(0, 1 + Math.floor(rnd() * 2));
        const created = new Date(date);
        created.setHours(11 + hi, Math.floor(rnd() * 60), 0, 0);
        const wait = 5 + rnd() * 14;
        const lines = take.map((d) => ({ recipe_id: "", name: d, qty: 1, price: 10 }));
        const total = lines.length * 10;
        orders.push({
          id: uid(), org_id: orgId, order_number: `KOK-${String(n++).padStart(4, "0")}`, order_type: "dine_in", table_id: null,
          customer_id: null, guest_name: null, items: lines, subtotal: total, tax: 0, tip: 0, total, discount: 0, status: "paid",
          kitchen_status: "served", kitchen_notes: null, source: "sumup", created_at: created.toISOString(),
          kitchen_started_at: new Date(created.getTime() + 60000 * (1 + rnd() * 3)).toISOString(),
          kitchen_ready_at: new Date(created.getTime() + 60000 * wait).toISOString(),
          kitchen_served_at: new Date(created.getTime() + 60000 * (wait + 1)).toISOString(),
        } as Order);
      }
    });
  }
  return orders;
}
