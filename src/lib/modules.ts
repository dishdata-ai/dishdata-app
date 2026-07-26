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
  Settings,
  Flame,
  LayoutGrid,
  Bike,
  Calculator,
  FileBarChart,
  ReceiptText,
  Timer,
  BadgeEuro,
  KanbanSquare,
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
  { id: "kitchen", name: "Kitchen", path: "/kitchen", icon: Flame, group: "Operate", blurb: "Live ticket board for the line" },
  { id: "floor", name: "Floor & Reservations", path: "/floor", icon: LayoutGrid, group: "Operate", blurb: "Tables, seating and bookings" },
  { id: "recipes", name: "Recipes", path: "/recipes", icon: ChefHat, group: "Operate", blurb: "Plate costing and margins" },
  { id: "inventory", name: "Inventory", path: "/inventory", icon: Boxes, group: "Operate", blurb: "Stock, waste and par levels" },
  { id: "procurement", name: "Procurement", path: "/procurement", icon: Truck, group: "Operate", blurb: "Vendors and purchase orders" },
  { id: "delivery", name: "Delivery", path: "/delivery", icon: Bike, group: "Operate", blurb: "Courier assignment and tracking" },
  { id: "sales", name: "Sales", path: "/sales", icon: TrendingUp, group: "Grow", blurb: "Revenue and top sellers" },
  { id: "insights", name: "AI Insights", path: "/insights", icon: Sparkles, group: "Grow", blurb: "Computed recommendations" },
  { id: "menu", name: "Menu Engineering", path: "/menu", icon: SquareMenu, group: "Grow", blurb: "Stars, plowhorses, puzzles, dogs" },
  { id: "crm", name: "Customers", path: "/customers", icon: Users, group: "Grow", blurb: "Member directory and profiles" },
  { id: "marketing", name: "Marketing", path: "/marketing", icon: Megaphone, group: "Grow", blurb: "Campaigns, segments & sends" },
  { id: "loyalty", name: "Loyalty", path: "/loyalty", icon: Gift, group: "Grow", blurb: "Tiers, rewards & ways to earn" },
  { id: "reports", name: "Reports", path: "/reports", icon: FileBarChart, group: "Grow", blurb: "Exports and period reports" },
  { id: "finance", name: "Finance", path: "/finance", icon: Wallet, group: "Money", blurb: "P&L, cash flow, budgets" },
  { id: "accounting", name: "Accounting", path: "/accounting", icon: Calculator, group: "Money", blurb: "Expenses and tax summary" },
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

export const moduleById = (id: string) => MODULES.find((m) => m.id === id);

/** Mirrors default_modules_for_role() in setup.sql. */
export const ROLE_DEFAULT_MODULES: Record<Role, "all" | string[]> = {
  owner: "all",
  admin: "all",
  manager: ["dashboard", "myday", "pos", "orders", "kitchen", "floor", "recipes", "inventory", "procurement", "delivery", "sales", "insights", "menu", "reports", "staff", "timeclock", "tasks", "crm", "zreport"],
  staff: ["dashboard", "myday", "pos", "orders", "kitchen", "floor", "timeclock", "tasks"],
  accountant: ["dashboard", "myday", "finance", "accounting", "reports", "zreport", "insights"],
  viewer: ["dashboard", "sales", "insights"],
};

export function defaultModulesFor(role: Role): string[] {
  const d = ROLE_DEFAULT_MODULES[role];
  return d === "all" ? MODULES.map((m) => m.id) : d;
}
