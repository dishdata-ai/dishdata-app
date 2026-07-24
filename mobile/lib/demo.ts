// In-memory demo dataset so the app is fully explorable without a backend.
// Mirrors the web app's demo-mode philosophy (every feature works pre-Supabase),
// but uses a process-lifetime store instead of localStorage.

import type {
  Org,
  Employee,
  Recipe,
  InventoryItem,
  Task,
  Order,
  TimeEntry,
  Payment,
  Customer,
  RestaurantTable,
  Delivery,
} from "@/lib/types";

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const nowISO = () => new Date().toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export const DEMO_ORG: Org = {
  id: "demo-org",
  name: "Lumen Bistro",
  slug: "lumen-bistro",
  logo_url: null,
  accent_color: "#10b981",
  currency: "USD",
  tax_rate: 8.5,
  target_food_cost_pct: 28,
  onboarding_completed: true,
  settings: {},
};

export const DEMO_ME: Employee = {
  id: "emp-me",
  org_id: DEMO_ORG.id,
  user_id: "demo-user",
  name: "Alex Rivera",
  role_title: "Floor Lead",
  hourly_rate: 24,
  pin: "1234",
  shift_note: "Section 3 + bar pickup",
  avatar_hue: 160,
  is_active: true,
};

function seedRecipes(): Recipe[] {
  const r = (name: string, category: string, price: number, emoji: string, prep = 8): Recipe => ({
    id: uid(),
    org_id: DEMO_ORG.id,
    name,
    category,
    price,
    prep_minutes: prep,
    emoji,
    image_url: null,
    is_active: true,
  });
  return [
    r("Truffle Fries", "Starters", 9, "🍟", 6),
    r("Burrata & Heirloom", "Starters", 14, "🍅", 5),
    r("Crispy Calamari", "Starters", 13, "🦑", 9),
    r("Smash Burger", "Mains", 17, "🍔", 11),
    r("Margherita Pizza", "Mains", 16, "🍕", 12),
    r("Pan-Seared Salmon", "Mains", 26, "🐟", 14),
    r("Ribeye Steak", "Mains", 38, "🥩", 18),
    r("Mushroom Risotto", "Mains", 21, "🍚", 16),
    r("Caesar Salad", "Mains", 13, "🥗", 6),
    r("Tiramisu", "Desserts", 10, "🍰", 4),
    r("Lava Cake", "Desserts", 11, "🍫", 9),
    r("House Lemonade", "Drinks", 5, "🍋", 2),
    r("Cold Brew", "Drinks", 5, "☕", 2),
    r("Negroni", "Drinks", 14, "🍸", 3),
  ];
}

function seedInventory(): InventoryItem[] {
  const i = (
    name: string,
    category: string,
    stock: number,
    unit: string,
    par: number,
    cost: number,
  ): InventoryItem => ({
    id: uid(),
    org_id: DEMO_ORG.id,
    name,
    category,
    stock,
    unit,
    par_level: par,
    unit_cost: cost,
    expires_at: null,
    vendor_id: null,
    item_type: "ingredient",
    sku: null,
    location_id: null,
    serial_number: null,
    purchase_date: null,
    purchase_cost: null,
    depreciation_months: null,
    asset_status: null,
  });
  return [
    i("Salmon Fillet", "Seafood", 6, "kg", 12, 18.5),
    i("Ribeye", "Meat", 4, "kg", 10, 32),
    i("Mozzarella", "Dairy", 9, "kg", 8, 9.2),
    i("Heirloom Tomato", "Produce", 3, "kg", 9, 6.4),
    i("Arborio Rice", "Dry", 14, "kg", 10, 3.1),
    i("Coffee Beans", "Beverage", 2, "kg", 6, 21),
    i("Truffle Oil", "Pantry", 1, "L", 3, 44),
    i("Burger Buns", "Bakery", 22, "ea", 40, 0.45),
  ];
}

function seedTasks(): Task[] {
  const t = (
    title: string,
    priority: Task["priority"],
    status: Task["status"],
    pos: number,
  ): Task => ({
    id: uid(),
    org_id: DEMO_ORG.id,
    title,
    description: null,
    status,
    priority,
    assignee_employee_id: DEMO_ME.id,
    partner_email: null,
    due_date: null,
    position: pos,
    completed_at: status === "done" ? hoursAgo(1) : null,
    created_at: hoursAgo(6),
  });
  return [
    t("Prep mise en place for dinner service", "high", "todo", 1),
    t("Restock bar garnishes", "medium", "todo", 2),
    t("Wipe down POS terminals", "low", "in_progress", 3),
    t("Count walk-in cooler", "medium", "todo", 4),
    t("Brief new server on Section 3", "high", "done", 5),
  ];
}

function seedOrders(menu: Recipe[]): Order[] {
  const line = (rec: Recipe, qty: number) => ({
    recipe_id: rec.id,
    name: rec.name,
    qty,
    price: rec.price,
  });
  const build = (
    num: string,
    table: string,
    items: { rec: Recipe; qty: number }[],
    kitchen: Order["kitchen_status"],
    mins: number,
  ): Order => {
    const lines = items.map((x) => line(x.rec, x.qty));
    // VAT-included (gross): break VAT out of the price; subtotal is NET.
    const gross = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const tax = +(gross * (DEMO_ORG.tax_rate / (100 + DEMO_ORG.tax_rate))).toFixed(2);
    const subtotal = +(gross - tax).toFixed(2);
    return {
      id: uid(),
      org_id: DEMO_ORG.id,
      order_number: num,
      order_type: "dine_in",
      table_id: table,
      customer_id: null,
      guest_name: null,
      items: lines,
      subtotal,
      tax,
      tip: 0,
      total: gross,
      status: "open",
      kitchen_status: kitchen,
      kitchen_notes: null,
      source: "pos",
      created_at: minsAgo(mins),
    };
  };
  const byName = (n: string) => menu.find((m) => m.name === n)!;
  const orders = [
    build("A-104", "T4", [
      { rec: byName("Smash Burger"), qty: 2 },
      { rec: byName("Truffle Fries"), qty: 1 },
    ], "new", 3),
    build("A-103", "T2", [
      { rec: byName("Pan-Seared Salmon"), qty: 1 },
      { rec: byName("Caesar Salad"), qty: 1 },
    ], "preparing", 9),
    build("A-102", "T7", [
      { rec: byName("Margherita Pizza"), qty: 1 },
      { rec: byName("Negroni"), qty: 2 },
    ], "ready", 14),
  ];
  // One delivery-type order, ready for pickup, so the demo Delivery tab has
  // a real order (address/items/total) to attach a rider trip to.
  const deliveryLines = [
    { rec: byName("Margherita Pizza"), qty: 1 },
    { rec: byName("House Lemonade"), qty: 2 },
  ].map((x) => line(x.rec, x.qty));
  // VAT-included (gross): break VAT out of the price; subtotal is NET.
  const deliveryGross = deliveryLines.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryTax = +(deliveryGross * (DEMO_ORG.tax_rate / (100 + DEMO_ORG.tax_rate))).toFixed(2);
  const deliverySubtotal = +(deliveryGross - deliveryTax).toFixed(2);
  orders.push({
    id: uid(),
    org_id: DEMO_ORG.id,
    order_number: "A-101",
    order_type: "delivery",
    table_id: null,
    customer_id: null,
    guest_name: "Jordan Reyes",
    items: deliveryLines,
    subtotal: deliverySubtotal,
    tax: deliveryTax,
    tip: 0,
    total: deliveryGross,
    status: "open",
    kitchen_status: "ready",
    kitchen_notes: null,
    source: "pos",
    created_at: minsAgo(18),
  });
  return orders;
}

function seedDeliveries(orders: Order[]): Delivery[] {
  const deliveryOrder = orders.find((o) => o.order_type === "delivery")!;
  const now = nowISO();
  return [
    {
      id: uid(),
      org_id: DEMO_ORG.id,
      order_id: deliveryOrder.id,
      courier_employee_id: DEMO_ME.id,
      address: "482 Riverside Ave, Apt 3B",
      phone: "+1 555-0142",
      status: "assigned",
      eta: null,
      notes: "Ring doorbell, leave at door if no answer",
      created_at: minsAgo(15),
      updated_at: now,
      created_by: null,
      postcode: "10115",
      delivery_fee: 2.5,
      current_lat: null,
      current_lng: null,
      location_updated_at: null,
    },
  ];
}

function seedTables(): RestaurantTable[] {
  const t = (name: string, seats: number, zone: string): RestaurantTable => ({
    id: uid(),
    org_id: DEMO_ORG.id,
    name,
    seats,
    zone,
    status: "open",
  });
  return [
    t("1", 2, "Window"),
    t("2", 2, "Window"),
    t("3", 4, "Main"),
    t("4", 4, "Main"),
    t("5", 6, "Patio"),
    t("6", 8, "Private"),
  ];
}

function seedCustomers(): Customer[] {
  const c = (name: string, tier: string, visits: number, spend: number): Customer => ({
    id: uid(),
    org_id: DEMO_ORG.id,
    name,
    email: null,
    phone: null,
    visits,
    total_spend: spend,
    points: Math.floor(spend),
    tier,
    last_visit_at: hoursAgo(48),
  });
  return [
    c("Maya Chen", "Gold", 18, 1240),
    c("Diego Santos", "Silver", 9, 560),
    c("Priya Nair", "Platinum", 31, 2480),
    c("Tom Becker", "Bronze", 3, 145),
  ];
}

export interface DemoState {
  org: Org;
  me: Employee;
  recipes: Recipe[];
  inventory: InventoryItem[];
  tasks: Task[];
  orders: Order[];
  payments: Payment[];
  customers: Customer[];
  tables: RestaurantTable[];
  deliveries: Delivery[];
  timeEntry: TimeEntry | null; // open shift, if clocked in
}

function build(): DemoState {
  const recipes = seedRecipes();
  const orders = seedOrders(recipes);
  return {
    org: DEMO_ORG,
    me: DEMO_ME,
    recipes,
    inventory: seedInventory(),
    tasks: seedTasks(),
    orders,
    payments: [],
    customers: seedCustomers(),
    tables: seedTables(),
    deliveries: seedDeliveries(orders),
    timeEntry: {
      id: uid(),
      org_id: DEMO_ORG.id,
      employee_id: DEMO_ME.id,
      clock_in: hoursAgo(3.5),
      clock_out: null,
      break_seconds: 0,
      break_started_at: null,
      note: null,
    },
  };
}

// Single process-lifetime instance. Mutated in place by the demo api layer.
export const demo: DemoState = build();
