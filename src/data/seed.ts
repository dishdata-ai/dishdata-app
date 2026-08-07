// Demo seed data, mirrored by seed_demo_data() in supabase/setup.sql.
// Used by demo mode (localStorage) when Supabase is not configured.

import { uid } from "@/lib/utils";
import type {
  Vendor,
  InventoryItem,
  StorageLocation,
  AssetMaintenance,
  Recipe,
  RecipeIngredient,
  RestaurantTable,
  Employee,
  Customer,
  PurchaseOrder,
  Task,
  Order,
  Payment,
  Expense,
  PaymentMethod,
} from "@/lib/api/database.types";

export interface SeedBundle {
  vendors: Vendor[];
  storage_locations: StorageLocation[];
  inventory_items: InventoryItem[];
  asset_maintenance: AssetMaintenance[];
  recipes: Recipe[];
  recipe_ingredients: RecipeIngredient[];
  restaurant_tables: RestaurantTable[];
  employees: Employee[];
  customers: Customer[];
  purchase_orders: PurchaseOrder[];
  tasks: Task[];
  orders: Order[];
  payments: Payment[];
  expenses: Expense[];
}

const daysFromNow = (d: number) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

export function buildSeed(orgId: string): SeedBundle {
  const v = (name: string, category: string, rating: number, onTime: number, spend: number, idx: number): Vendor => ({
    id: uid(), org_id: orgId, name, category, contact_email: null, contact_phone: null,
    rating, on_time_pct: onTime, monthly_spend: spend, price_index: idx,
  });
  const vendors = [
    v("Ocean Direct", "Seafood", 4.8, 96, 8420, 104),
    v("Prime Cuts Co", "Meat", 4.6, 92, 6150, 110),
    v("GreenField Farms", "Produce", 4.9, 98, 3870, 95),
    v("Casa Latteria", "Dairy", 4.4, 88, 2940, 101),
    v("Pantry Plus", "Dry Goods", 4.2, 94, 2210, 92),
    v("Vine & Co", "Beverage", 4.7, 90, 4380, 99),
  ];
  const vid = (name: string) => vendors.find((x) => x.name === name)!.id;

  const loc = (name: string, area: string, shelf: string, notes: string): StorageLocation => ({
    id: uid(), org_id: orgId, name, area, shelf, notes,
  });
  const storage_locations = [
    loc("Walk-in F1", "Walk-in", "F1", "Chilled produce & dairy"),
    loc("Walk-in F2", "Walk-in", "F2", "Proteins & seafood"),
    loc("Freezer Z1", "Freezer", "Z1", "Frozen goods"),
    loc("Dry Goods B1", "Dry Store", "B1", "Grains, oils, staples"),
    loc("Dry Goods B3", "Dry Store", "B3", "Dry goods & snacks"),
    loc("Prep Counter", "Prep", "C1", "Active use items"),
    loc("Back Office", "Back Office", "", "Equipment, tools & packaging"),
  ];
  const lid = (name: string) => storage_locations.find((x) => x.name === name)!.id;
  const chilled = new Set(["Seafood", "Meat", "Dairy", "Produce"]);

  // Base item factory — every item carries the new type/location/labeling fields.
  const base = (
    name: string, category: string, itemType: InventoryItem["item_type"], stock: number,
    unit: string, par: number, cost: number, locationName: string, sku: string | null,
  ): InventoryItem => ({
    id: uid(), org_id: orgId, name, category, item_type: itemType, stock, unit,
    par_level: par, unit_cost: cost, expires_at: null, vendor_id: null,
    location_id: lid(locationName), sku,
    serial_number: null, purchase_date: null, purchase_cost: null,
    depreciation_months: null, asset_status: null,
  });

  const inv = (name: string, category: string, stock: number, unit: string, par: number, cost: number, expDays: number, vendor: string, sku?: string | null, loc?: string): InventoryItem => {
    let locName = loc;
    if (!locName) {
      if (chilled.has(category)) locName = ["Seafood", "Meat"].includes(category) ? "Walk-in F2" : "Walk-in F1";
      else if (category === "Beverage") locName = "Dry Goods B3";
      else locName = "Dry Goods B1";
    }
    return {
      ...base(name, category, "ingredient", stock, unit, par, cost, locName, sku ?? null),
      expires_at: daysFromNow(expDays), vendor_id: vid(vendor),
    };
  };

  const equip = (name: string, sku: string, serial: string, purchaseDaysAgo: number, cost: number, depMonths: number, status: InventoryItem["asset_status"]): InventoryItem => ({
    ...base(name, "Equipment", "equipment", 1, "pc", 0, 0, "Back Office", sku),
    serial_number: serial, purchase_date: daysFromNow(-purchaseDaysAgo),
    purchase_cost: cost, depreciation_months: depMonths, asset_status: status,
  });

  const inventory_items = [
    // Chilled proteins (Walk-in F2)
    inv("Salmon fillet", "Seafood", 14, "kg", 20, 34, 2, "Ocean Direct", "FISH-SAL-01", "Walk-in F2"),
    inv("Black cod", "Seafood", 5, "kg", 8, 41, 2, "Ocean Direct", "FISH-COD-01", "Walk-in F2"),
    inv("Squid", "Seafood", 10, "kg", 10, 13, 2, "Ocean Direct", "FISH-SQU-01", "Walk-in F2"),
    inv("Wagyu beef", "Meat", 8, "kg", 12, 62, 4, "Prime Cuts Co", "MEAT-WAG-01", "Walk-in F2"),
    // Produce & dairy (Walk-in F1)
    inv("Heirloom tomatoes", "Produce", 6, "kg", 15, 7.5, 3, "GreenField Farms", "PROD-TOM-01", "Walk-in F1"),
    inv("Romaine lettuce", "Produce", 18, "kg", 12, 3.8, 4, "GreenField Farms", "PROD-ROM-01", "Walk-in F1"),
    inv("Burrata", "Dairy", 9, "kg", 8, 18, 3, "Casa Latteria", "DAIY-BUR-01", "Walk-in F1"),
    inv("Cream cheese", "Dairy", 16, "kg", 10, 9.2, 12, "Casa Latteria", "DAIY-CRM-01", "Walk-in F1"),
    inv("Butter blocks", "Dairy", 24, "kg", 20, 8.2, 14, "Casa Latteria", "DAIY-BUT-01", "Walk-in F1"),
    // Dry goods & staples (Dry Goods B1)
    inv("Arborio rice", "Dry Goods", 42, "kg", 25, 4.2, 180, "Pantry Plus", "DRY-RIC-01", "Dry Goods B1"),
    inv("Olive oil (premium)", "Dry Goods", 8, "L", 6, 28, 240, "Pantry Plus", "DRY-OIL-01", "Dry Goods B1"),
    inv("Balsamic vinegar", "Dry Goods", 4, "L", 5, 18, 365, "Pantry Plus", "DRY-VIN-01", "Dry Goods B1"),
    inv("Sea salt (fine)", "Dry Goods", 5, "kg", 8, 2.5, 365, "Pantry Plus", "DRY-SAL-01", "Dry Goods B1"),
    // Sweets & chocolate (Dry Goods B3)
    inv("Dark chocolate 70%", "Dry Goods", 11, "kg", 10, 16, 240, "Pantry Plus", "DRY-CHC-01", "Dry Goods B3"),
    inv("Vanilla extract", "Dry Goods", 2, "L", 3, 35, 365, "Pantry Plus", "DRY-VAN-01", "Dry Goods B3"),
    // Beverages (Dry Goods B3)
    inv("Prosecco", "Beverage", 36, "btl", 24, 11, 365, "Vine & Co", "BEV-PRO-01", "Dry Goods B3"),
    inv("Cold brew concentrate", "Beverage", 7, "L", 10, 8.5, 14, "Vine & Co", "BEV-COF-01", "Dry Goods B3"),
    inv("Red wine (house)", "Beverage", 12, "btl", 10, 14, 365, "Vine & Co", "BEV-RED-01", "Dry Goods B3"),
    // Supplies — packaging (Back Office)
    base("Takeaway boxes (large)", "Packaging", "supply", 120, "pc", 80, 0.45, "Back Office", "PKG-BOX-L"),
    base("Takeaway boxes (small)", "Packaging", "supply", 180, "pc", 120, 0.28, "Back Office", "PKG-BOX-S"),
    base("Branded stickers (roll)", "Packaging", "supply", 6, "roll", 10, 12, "Back Office", "PKG-STK-01"),
    base("Napkins (case)", "Supplies", "supply", 14, "case", 8, 9.5, "Back Office", "SUP-NAP-CS"),
    base("Plastic gloves (box)", "Supplies", "supply", 8, "box", 12, 6.5, "Back Office", "SUP-GLV-01"),
    base("Chef knives set", "Supplies", "supply", 3, "set", 2, 85, "Back Office", "SUP-KNF-01"),
    // Equipment (Back Office)
    equip("Espresso Machine", "EQ-ESP-01", "LM-2024-8841", 400, 6800, 60, "in_service"),
    equip("Vacuum Sealer", "EQ-VAC-01", "VS-7710", 120, 540, 36, "in_service"),
    equip("Label Printer", "EQ-PRN-01", "ZB-410", 60, 320, 36, "maintenance"),
    equip("Sous Vide Cooker", "EQ-SOU-01", "Anova-PRO-2025", 180, 380, 48, "in_service"),
    equip("Meat Grinder", "EQ-GRD-01", "Hobart-MG24", 240, 1200, 84, "in_service"),
  ];
  const iid = (name: string) => inventory_items.find((x) => x.name === name)!.id;

  const asset_maintenance: AssetMaintenance[] = [
    {
      id: uid(), org_id: orgId, item_id: iid("Espresso Machine"), performed_at: daysFromNow(-30),
      kind: "service", cost: 140, note: "Descale + group head gasket replaced",
      next_due_at: daysFromNow(150), created_at: daysAgo(30),
    },
    {
      id: uid(), org_id: orgId, item_id: iid("Vacuum Sealer"), performed_at: daysFromNow(-60),
      kind: "inspection", cost: 0, note: "Annual inspection passed",
      next_due_at: daysFromNow(300), created_at: daysAgo(60),
    },
    {
      id: uid(), org_id: orgId, item_id: iid("Meat Grinder"), performed_at: daysFromNow(-14),
      kind: "repair", cost: 320, note: "Blade sharpening + bearing replacement",
      next_due_at: daysFromNow(180), created_at: daysAgo(14),
    },
    {
      id: uid(), org_id: orgId, item_id: iid("Sous Vide Cooker"), performed_at: daysFromNow(-90),
      kind: "service", cost: 85, note: "Seal replacement + calibration check",
      next_due_at: daysFromNow(270), created_at: daysAgo(90),
    },
  ];

  const recipes: Recipe[] = [];
  const recipe_ingredients: RecipeIngredient[] = [];
  const addRecipe = (
    name: string, category: string, price: number, prep: number, emoji: string,
    ings: [string, string, number, number, string | null][], // [name, qtyDisplay, qtyNumeric, cost, inventoryName]
  ) => {
    const id = uid();
    recipes.push({ id, org_id: orgId, name, category, price, prep_minutes: prep, emoji, description: null, image_url: null, is_active: true, sold_out_until: null });
    for (const [iname, qd, qn, cost, invName] of ings) {
      recipe_ingredients.push({
        id: uid(), org_id: orgId, recipe_id: id, name: iname, qty_display: qd,
        qty_numeric: qn, cost, inventory_item_id: invName ? iid(invName) : null,
      });
    }
  };

  addRecipe("Grilled Salmon", "Mains", 28, 18, "🐟", [
    ["Salmon fillet 200g", "1 pc", 0.2, 6.8, "Salmon fillet"],
    ["Asparagus", "80g", 0, 1.1, null],
    ["Lemon butter", "30g", 0, 0.7, null],
    ["Herbs & seasoning", "10g", 0, 0.3, null],
  ]);
  addRecipe("Truffle Risotto", "Mains", 24, 25, "🍚", [
    ["Arborio rice", "120g", 0.12, 0.9, "Arborio rice"],
    ["Truffle oil", "10ml", 0, 1.8, null],
    ["Parmesan", "40g", 0, 1.2, null],
    ["Stock & wine", "300ml", 0, 0.8, null],
  ]);
  addRecipe("Wagyu Burger", "Mains", 26, 14, "🍔", [
    ["Wagyu patty 180g", "1 pc", 0.18, 5.4, "Wagyu beef"],
    ["Brioche bun", "1 pc", 0, 0.9, null],
    ["Aged cheddar", "30g", 0, 0.8, null],
    ["Fixings & sauce", "—", 0, 0.9, null],
  ]);
  addRecipe("Burrata Caprese", "Appetizers", 16, 8, "🍅", [
    ["Burrata", "125g", 0.125, 2.9, "Burrata"],
    ["Heirloom tomatoes", "150g", 0.15, 1.4, "Heirloom tomatoes"],
    ["Basil & balsamic", "—", 0, 0.5, null],
  ]);
  addRecipe("Crispy Calamari", "Appetizers", 14, 12, "🦑", [
    ["Squid", "180g", 0.18, 2.6, "Squid"],
    ["Flour & batter", "60g", 0, 0.3, null],
    ["Aioli", "40g", 0, 0.5, null],
  ]);
  addRecipe("Chocolate Lava Cake", "Desserts", 12, 20, "🍫", [
    ["Dark chocolate", "80g", 0.08, 1.3, "Dark chocolate 70%"],
    ["Butter & eggs", "—", 0, 0.8, null],
    ["Vanilla gelato", "1 scoop", 0, 0.9, null],
  ]);
  addRecipe("Basque Cheesecake", "Desserts", 11, 10, "🍰", [
    ["Cream cheese", "90g", 0.09, 1.4, "Cream cheese"],
    ["Cream & eggs", "—", 0, 0.7, null],
    ["Berry coulis", "30g", 0, 0.5, null],
  ]);
  addRecipe("Yuzu Spritz", "Beverages", 13, 4, "🍹", [
    ["Yuzu juice", "30ml", 0, 1.1, null],
    ["Prosecco", "90ml", 0.12, 1.3, "Prosecco"],
    ["Soda & garnish", "—", 0, 0.3, null],
  ]);
  addRecipe("Cold Brew Tonic", "Beverages", 8, 3, "☕", [
    ["Cold brew", "120ml", 0.12, 0.7, "Cold brew concentrate"],
    ["Tonic", "100ml", 0, 0.5, null],
    ["Orange peel", "—", 0, 0.1, null],
  ]);
  addRecipe("Chef's Tasting Board", "Specials", 38, 22, "🧀", [
    ["Cured meats", "120g", 0, 4.8, null],
    ["Artisan cheeses", "120g", 0, 4.2, null],
    ["Accompaniments", "—", 0, 1.6, null],
  ]);
  addRecipe("Miso Glazed Cod", "Specials", 32, 20, "🐠", [
    ["Black cod 180g", "1 pc", 0.18, 7.2, "Black cod"],
    ["Miso glaze", "40g", 0, 0.8, null],
    ["Bok choy & rice", "—", 0, 1.0, null],
  ]);
  addRecipe("Caesar Salad", "Appetizers", 13, 7, "🥗", [
    ["Romaine", "150g", 0.15, 0.8, "Romaine lettuce"],
    ["Dressing & anchovy", "50g", 0, 0.9, null],
    ["Croutons & parmesan", "—", 0, 0.6, null],
  ]);

  const restaurant_tables: RestaurantTable[] = (
    [
      ["T1", 2, "Window"], ["T2", 2, "Window"], ["T3", 4, "Main"], ["T4", 4, "Main"],
      ["T5", 4, "Main"], ["T6", 6, "Main"], ["T7", 6, "Patio"], ["T8", 8, "Patio"],
      ["B1", 1, "Bar"], ["B2", 1, "Bar"], ["B3", 1, "Bar"],
    ] as [string, number, string][]
  ).map(([name, seats, zone]) => ({ id: uid(), org_id: orgId, name, seats, zone, status: "open" as const }));

  const emp = (name: string, role: string, rate: number, note: string, hue: number): Employee => ({
    id: uid(), org_id: orgId, user_id: null, name, role_title: role, hourly_rate: rate,
    pin: null, shift_note: note, avatar_hue: hue, is_active: true,
  });
  const employees = [
    emp("Maria Santos", "Head Chef", 38, "Mon–Fri · 10:00–19:00", 160),
    emp("James Okafor", "Sous Chef", 28, "Tue–Sat · 12:00–21:00", 200),
    emp("Lena Fischer", "Restaurant Manager", 32, "Mon–Fri · 11:00–20:00", 260),
    emp("Diego Ruiz", "Server Lead", 19, "Wed–Sun · 16:00–24:00", 30),
    emp("Aisha Khan", "Server", 16, "Thu–Mon · 16:00–23:00", 320),
    emp("Tom Nguyen", "Bartender", 18, "Wed–Sun · 17:00–01:00", 90),
  ];

  const cust = (name: string, email: string, visits: number, spend: number, tier: string, lastDays: number): Customer => ({
    id: uid(), org_id: orgId, name, email, phone: null, visits, total_spend: spend,
    points: spend * 2, tier, last_visit_at: daysAgo(lastDays),
  });
  const customers = [
    cust("Olivia Bennett", "olivia.b@email.com", 34, 2180, "Platinum", 2),
    cust("Marcus Chen", "m.chen@email.com", 22, 1430, "Gold", 5),
    cust("Sofia Almeida", "sofia.a@email.com", 18, 990, "Gold", 7),
    cust("Daniel Wright", "d.wright@email.com", 11, 540, "Silver", 3),
    cust("Priya Patel", "priya.p@email.com", 7, 310, "Silver", 14),
    cust("Ethan Moore", "ethan.m@email.com", 3, 120, "Bronze", 30),
  ];

  const purchase_orders: PurchaseOrder[] = [
    { id: uid(), org_id: orgId, po_number: "PO-1001", vendor_id: vid("Ocean Direct"), vendor_name: "Ocean Direct", status: "confirmed", expected_at: "Tomorrow", total: 1240, items_count: 6, created_at: daysAgo(1) },
    { id: uid(), org_id: orgId, po_number: "PO-1002", vendor_id: vid("GreenField Farms"), vendor_name: "GreenField Farms", status: "sent", expected_at: "Thu", total: 480, items_count: 12, created_at: daysAgo(1) },
    { id: uid(), org_id: orgId, po_number: "PO-1003", vendor_id: vid("Prime Cuts Co"), vendor_name: "Prime Cuts Co", status: "draft", expected_at: "TBD", total: 980, items_count: 4, created_at: daysAgo(0) },
  ];

  const task = (title: string, description: string, status: Task["status"], priority: Task["priority"], position: number, partner?: string): Task => ({
    id: uid(), org_id: orgId, title, description, status, priority,
    assignee_employee_id: null, partner_email: partner ?? null, due_date: null,
    is_partner_task: false, assignee_user_id: null, effort: 1, category: null,
    checklist: [], links: [],
    position, completed_at: null, created_at: daysAgo(1),
  });
  const tasks = [
    task("Deep-clean walk-in fridge", "Monthly deep clean, log temperatures", "todo", "high", 1),
    task("Update allergen chart", "New menu items need allergen labels", "todo", "medium", 2),
    task("Train new server on POS", "Onboarding for weekend hire", "in_progress", "medium", 1),
    task("Repair patio heater", "Facilities contractor visit", "todo", "low", 3, "facilities@partnerco.com"),
  ];

  const { orders, payments } = buildOrderHistory(orgId, recipes);
  const expenses = buildExpenses(orgId);

  return { vendors, storage_locations, inventory_items, asset_maintenance, recipes, recipe_ingredients, restaurant_tables, employees, customers, purchase_orders, tasks, orders, payments, expenses };
}

/** Deterministic-ish pseudo-random so the demo looks alive but stable per session. */
let rngState = 42;
const rng = () => {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
};

/** ~2 weeks of paid order history so charts, reports and insights have signal. */
export function buildOrderHistory(orgId: string, recipes: Recipe[]) {
  const orders: Order[] = [];
  const payments: Payment[] = [];
  const methods: PaymentMethod[] = ["card", "card", "card", "cash", "wallet"];
  let orderNo = 1;

  // Popularity weights: mains/apps sell more than specials
  const weightFor = (r: Recipe) =>
    r.category === "Mains" ? 5 : r.category === "Appetizers" ? 4 : r.category === "Beverages" ? 3 : r.category === "Desserts" ? 3 : 1;
  const weighted: Recipe[] = recipes.flatMap((r) => Array(weightFor(r)).fill(r));

  for (let day = 14; day >= 1; day--) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    const dow = date.getDay();
    const isWeekend = dow === 5 || dow === 6;
    const count = (isWeekend ? 16 : 9) + Math.floor(rng() * 6);

    for (let i = 0; i < count; i++) {
      const hour = [12, 12, 13, 13, 14, 18, 19, 19, 20, 20, 21][Math.floor(rng() * 11)];
      const placed = new Date(date);
      placed.setHours(hour, Math.floor(rng() * 60), 0, 0);

      const nLines = 1 + Math.floor(rng() * 3);
      const lineMap = new Map<string, { recipe: Recipe; qty: number }>();
      for (let l = 0; l < nLines; l++) {
        const r = weighted[Math.floor(rng() * weighted.length)];
        const existing = lineMap.get(r.id);
        if (existing) existing.qty += 1;
        else lineMap.set(r.id, { recipe: r, qty: 1 });
      }
      const items = [...lineMap.values()].map(({ recipe, qty }) => ({
        recipe_id: recipe.id,
        name: recipe.name,
        qty,
        price: recipe.price,
      }));
      const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
      const tax = +(subtotal * 0.085).toFixed(2);
      const tip = rng() > 0.5 ? +(subtotal * (0.1 + rng() * 0.1)).toFixed(2) : 0;
      const total = +(subtotal + tax + tip).toFixed(2);
      const id = uid();
      const method = methods[Math.floor(rng() * methods.length)];

      orders.push({
        id, org_id: orgId, order_number: `ORD-${String(orderNo++).padStart(4, "0")}`,
        order_type: rng() > 0.75 ? "takeaway" : "dine_in", table_id: null, customer_id: null,
        guest_name: null, items, subtotal, tax, tip, total, discount: 0, status: "paid",
        kitchen_status: "served", kitchen_notes: null, source: "pos", created_at: placed.toISOString(),
      });
      payments.push({
        id: uid(), org_id: orgId, order_id: id, method, amount: total,
        tip_amount: tip, split_label: null, created_at: placed.toISOString(),
      });
    }
  }
  return { orders, payments };
}

function buildExpenses(orgId: string): Expense[] {
  const mk = (daysBack: number, category: string, vendor: string, amount: number, taxPct = 0): Expense => {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    return {
      id: uid(), org_id: orgId, date: d.toISOString().slice(0, 10), category,
      vendor_name: vendor, amount, tax_amount: +(amount * taxPct).toFixed(2),
      receipt_url: null, note: null,
    };
  };
  return [
    mk(2, "Food & Beverage", "Ocean Direct", 1840, 0.05),
    mk(3, "Food & Beverage", "GreenField Farms", 620, 0.05),
    mk(5, "Utilities", "City Power & Gas", 740, 0.08),
    mk(6, "Rent", "Hartley Properties", 5200, 0),
    mk(8, "Food & Beverage", "Prime Cuts Co", 1390, 0.05),
    mk(9, "Marketing", "SocialBoost Agency", 450, 0.08),
    mk(11, "Maintenance", "FixIt Services", 280, 0.08),
    mk(12, "Supplies", "CleanPro Wholesale", 310, 0.08),
    mk(13, "Food & Beverage", "Casa Latteria", 540, 0.05),
  ];
}
