import {
  LayoutDashboard,
  MonitorSmartphone,
  ListOrdered,
  ChefHat,
  Boxes,
  TrendingUp,
  Truck,
  Sparkles,
  SquareMenu,
  Users,
  Heart,
  Gift,
  Megaphone,
  Wallet,
  Banknote,
  Settings,
  Flame,
  LayoutGrid,
  Bike,
  Store,
  Calculator,
  FileBarChart,
  ReceiptText,
  Timer,
  BadgeEuro,
  KanbanSquare,
  CalendarClock,
  ShieldCheck,
  ScrollText,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/api/database.types";

export type ModuleGroup = "Operate" | "Grow" | "Money" | "People" | "Admin";

export interface ModuleDef {
  id: string;
  name: string;
  path: string;
  icon: LucideIcon;
  group: ModuleGroup;
  /** Short description used by onboarding picker and command palette. */
  blurb: string;
}

/**
 * Single source of truth for the module registry.
 * Mirrors the `modules` seed + `default_modules_for_role()` in supabase/setup.sql.
 */
export const MODULES: ModuleDef[] = [
  { id: "dashboard", name: "Dashboard", path: "/", icon: LayoutDashboard, group: "Operate", blurb: "KPIs, trends and live signals" },
  { id: "pos", name: "Point of Sale", path: "/pos", icon: MonitorSmartphone, group: "Operate", blurb: "Ring up orders, tips & split bills" },
  { id: "orders", name: "Orders", path: "/orders", icon: ListOrdered, group: "Operate", blurb: "Full order history, search & receipts" },
  { id: "preorders", name: "Preorders", path: "/preorders", icon: CalendarClock, group: "Operate", blurb: "Event preorders & seating capacity" },
  { id: "kitchen", name: "Kitchen", path: "/kitchen", icon: Flame, group: "Operate", blurb: "Live ticket board for the line" },
  { id: "floor", name: "Floor & Reservations", path: "/floor", icon: LayoutGrid, group: "Operate", blurb: "Tables, seating and bookings" },
  { id: "recipes", name: "Recipes", path: "/recipes", icon: ChefHat, group: "Operate", blurb: "Plate costing and margins" },
  { id: "inventory", name: "Inventory", path: "/inventory", icon: Boxes, group: "Operate", blurb: "Stock, waste and par levels" },
  { id: "procurement", name: "Procurement", path: "/procurement", icon: Truck, group: "Operate", blurb: "Vendors and purchase orders" },
  { id: "delivery", name: "Delivery", path: "/delivery", icon: Bike, group: "Operate", blurb: "Courier assignment and tracking" },
  { id: "channels", name: "Delivery Channels", path: "/channels", icon: Store, group: "Operate", blurb: "Wolt, Uber Eats & Lieferando orders in one inbox" },
  { id: "sales", name: "Sales", path: "/sales", icon: TrendingUp, group: "Grow", blurb: "Revenue and top sellers" },
  { id: "insights", name: "AI Insights", path: "/insights", icon: Sparkles, group: "Grow", blurb: "Computed recommendations" },
  { id: "menu", name: "Menu Engineering", path: "/menu", icon: SquareMenu, group: "Grow", blurb: "Stars, plowhorses, puzzles, dogs" },
  { id: "crm", name: "Customers", path: "/customers", icon: Users, group: "Grow", blurb: "Member directory and profiles" },
  { id: "marketing", name: "Marketing", path: "/marketing", icon: Megaphone, group: "Grow", blurb: "Campaigns, segments & sends" },
  { id: "loyalty", name: "Loyalty", path: "/loyalty", icon: Gift, group: "Grow", blurb: "Tiers, rewards & ways to earn" },
  { id: "reports", name: "Reports", path: "/reports", icon: FileBarChart, group: "Grow", blurb: "Exports and period reports" },
  { id: "finance", name: "Finance", path: "/finance", icon: Wallet, group: "Money", blurb: "P&L, cash flow, budgets" },
  { id: "accounting", name: "Accounting", path: "/accounting", icon: Calculator, group: "Money", blurb: "Expenses and tax summary" },
  { id: "till", name: "Till & Cash", path: "/till", icon: Banknote, group: "Money", blurb: "Drawer float, cash in/out, close-out" },
  { id: "zreport", name: "Z-Report", path: "/zreport", icon: ReceiptText, group: "Money", blurb: "End-of-day close-out" },
  { id: "myday", name: "My Day", path: "/my", icon: Sun, group: "People", blurb: "Your shift, tasks and hours" },
  { id: "staff", name: "Staff", path: "/staff", icon: Users, group: "People", blurb: "Roster and labor cost" },
  { id: "timeclock", name: "Time Clock", path: "/timeclock", icon: Timer, group: "People", blurb: "Clock in/out and timesheets" },
  { id: "payroll", name: "Payroll", path: "/payroll", icon: BadgeEuro, group: "People", blurb: "German Lohnabrechnung — tax & social insurance" },
  { id: "tasks", name: "Tasks", path: "/tasks", icon: KanbanSquare, group: "People", blurb: "Kanban with assignment" },
  { id: "team", name: "Team & Access", path: "/team", icon: ShieldCheck, group: "Admin", blurb: "Members, invites, module access" },
  { id: "audit", name: "Audit Log", path: "/audit", icon: ScrollText, group: "Admin", blurb: "Who changed what, when" },
  { id: "settings", name: "Settings", path: "/settings", icon: Settings, group: "Admin", blurb: "Profile, branding, targets" },
];

export const MODULE_GROUPS: ModuleGroup[] = ["Operate", "Grow", "Money", "People", "Admin"];

/**
 * Modules forced on for every org regardless of what's saved in
 * `org.settings.enabled_modules` — some were added after early orgs
 * onboarded, so their saved list predates the module and would otherwise
 * hide it forever.
 *
 * Single source of truth: useOrg.tsx applies this to decide what's actually
 * on, and Settings.tsx uses the same list to render the toggle so the two
 * never show a different answer again — that drift (this list existing only
 * in useOrg.tsx, unknown to Settings) is exactly what made already-active
 * modules show as off in Settings before this.
 */
export const ALWAYS_ENABLED_MODULES = [
  "dashboard", "settings", "myday", "loyalty", "marketing", "orders", "preorders",
] as const;

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);

/** Mirrors default_modules_for_role() in setup.sql. */
export const ROLE_DEFAULT_MODULES: Record<Role, "all" | string[]> = {
  owner: "all",
  admin: "all",
  partner: "all",
  manager: ["dashboard", "myday", "pos", "orders", "preorders", "channels", "kitchen", "floor", "recipes", "inventory", "procurement", "delivery", "sales", "insights", "menu", "reports", "staff", "timeclock", "tasks", "crm", "zreport", "till"],
  staff: ["dashboard", "myday", "pos", "orders", "preorders", "channels", "kitchen", "floor", "timeclock", "tasks", "till"],
  accountant: ["dashboard", "myday", "finance", "accounting", "reports", "zreport", "till", "insights"],
  viewer: ["dashboard", "sales", "insights"],
};

export function defaultModulesFor(role: Role): string[] {
  const d = ROLE_DEFAULT_MODULES[role];
  return d === "all" ? MODULES.map((m) => m.id) : d;
}
