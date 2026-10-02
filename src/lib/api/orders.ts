import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoAudit, pushDemoNotification } from "@/lib/api/notifications";
import { computeTaxGroups, sumTax } from "@/lib/tax";
import { quoteStaffMeal, type MealLine } from "@/lib/staff-meal";
import { isTseEnabledForOrg } from "@/lib/tse-config";
import type {
  Order,
  OrderLine,
  OrderType,
  OrderStatus,
  Payment,
  PaymentMethod,
  KitchenStatus,
  Org,
  Recipe,
  Employee,
  RecipeIngredient,
  InventoryItem,
  InventoryTransaction,
  Customer,
  Delivery,
  TimeEntry,
} from "@/lib/api/database.types";

const dOrders = demoTable<Order>("orders");
const dPayments = demoTable<Payment>("payments");
const dOrgs = demoTable<Org>("orgs");
const dRecipes = demoTable<Recipe>("recipes");
const dIngredients = demoTable<RecipeIngredient>("recipe_ingredients");
const dItems = demoTable<InventoryItem>("inventory_items");
const dTx = demoTable<InventoryTransaction>("inventory_transactions");
const dCustomers = demoTable<Customer>("customers");
const dTimeEntries = demoTable<TimeEntry>("time_entries");

export async function listOrders(orgId: string, limit = 500): Promise<Order[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dOrders
      .list({ org_id: orgId } as Partial<Order>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Ninety days of orders for the Kitchen Ops demand model. listOrders() is capped at the newest 500,
 * which is only ~2–3 weeks for a busy kitchen; the model needs the full history to learn weekday patterns.
 * Only the columns the model reads are fetched.
 */
export async function listKitchenOrders(orgId: string): Promise<Order[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dOrders.list({ org_id: orgId } as Partial<Order>).filter((o) => o.created_at >= since);
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .select("id, org_id, order_number, order_type, guest_name, items, status, kitchen_status, kitchen_notes, source, created_at, kitchen_started_at, kitchen_ready_at, kitchen_served_at")
    .eq("org_id", orgId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as Order[];
}

export async function listPayments(orgId: string, limit = 500): Promise<Payment[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPayments
      .list({ org_id: orgId } as Partial<Payment>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("payments")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export interface CheckoutPayload {
  items: OrderLine[];
  orderType: OrderType;
  tableId?: string | null;
  customerId?: string | null;
  kitchenNotes?: string | null;
  tip?: number;
  /** Delivery address — required when orderType is "delivery". */
  address?: string | null;
  /** Flat € off the order, before tax. */
  discountAmount?: number;
  /** % off the order, before tax. Combines with discountAmount; both are capped to the order's gross. */
  discountPct?: number;
  /** Who rang the order up, for attribution. */
  employeeId?: string | null;
  /**
   * Charge the discount to this employee's staff allowance. The server enforces
   * the org's max %, monthly cap and PIN threshold — leaving this null keeps the
   * plain unrestricted manager discount.
   */
  staffDiscountEmployeeId?: string | null;
  /** Approver's PIN, when the discount is over the org's threshold. */
  approvalPin?: string | null;
  /**
   * The employee's OWN pin, confirming it's really them — set alongside
   * staffDiscountEmployeeId to claim a staff meal/drink instead of giving a
   * regular staff discount. See 0048: the daily allowance covers up to the
   * org's limit, anything beyond that is charged at the staff-discount rate
   * automatically (not blocked) — so ordering extra, or a parcel to take
   * home, is always allowed, just no longer free past the daily limit.
   */
  mealPin?: string | null;
  /**
   * Claim one of the signed-in partner's free meals this month (0070). Identity is the session, not a
   * parameter, so a partner can only ever claim for themselves; the server refuses anyone who isn't a
   * partner, and refuses once the month's meals are used. Mutually exclusive with the staff options above.
   */
  partnerMeal?: boolean;
  /**
   * The caller's org, used only to decide whether checkout routes through the
   * signing endpoint. The server re-reads its own config before signing, so
   * this never determines whether a sale is actually signed.
   */
  org?: Org | null;
  payments: { method: PaymentMethod; amount: number; tip_amount?: number; split_label?: string }[];
}

/** This month's staff-discount allowance for one employee. */
export interface StaffDiscountUsage {
  used: number;
  orders: number;
  cap: number | null;
  remaining: number | null;
  max_pct: number;
  pin_threshold: number | null;
}

export interface StaffDiscountReportRow {
  employee_id: string;
  employee_name: string;
  role_title: string;
  orders: number;
  discount_given: number;
  revenue: number;
  guests: number;
}

/** Today's staff-meal allowance for one employee. */
export interface StaffMealUsage {
  used: number;
  orders: number;
  limit: number | null;
  /** Free € left today. 0 on a day the employee hasn't clocked in (when the org uses the working-day rule). */
  remaining: number;
  /** Clocked in today. Absent from an older server; treat as true. */
  working_today?: boolean;
  /** % off whatever the free credit doesn't cover, today. Absent from an older server; fall back to the org's staff discount %. */
  pct?: number;
  drinks_used?: number;
  /** Cap on drinks the free credit may cover per day; null = no cap. */
  drinks_limit?: number | null;
  /** Drinks the free credit may still cover today; null = no cap. */
  drinks_remaining?: number | null;
}

/** The signed-in partner's free meals this calendar month. */
export interface PartnerMealUsage {
  /** Owner / admin / partner. Anyone else never sees partner meals. */
  eligible: boolean;
  /** Free meals per month; null/0 = feature off. */
  count: number | null;
  /** € ceiling on one free meal; null = the whole order is free. */
  max_value: number | null;
  used: number;
  remaining: number;
}

export interface StaffMealReportRow {
  employee_id: string;
  employee_name: string;
  role_title: string;
  orders: number;
  meal_amount: number;
  discounted_amount: number;
  revenue: number;
}

export interface CheckoutResult {
  order_id: string;
  order_number: string;
  total: number;
  discount?: number;
}

/** Demo-mode mirror of staff_discount_usage (0033). */
function demoStaffUsage(orgId: string, employeeId: string): StaffDiscountUsage {
  const org = dOrgs.get(orgId);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const mine = dOrders
    .list({ org_id: orgId } as Partial<Order>)
    .filter(
      (o) =>
        o.staff_discount_employee_id === employeeId &&
        o.status !== "void" &&
        o.status !== "refunded" &&
        new Date(o.created_at) >= monthStart,
    );
  const used = +mine.reduce((s, o) => s + (o.staff_discount_amount ?? 0), 0).toFixed(2);
  const cap = org?.staff_discount_monthly_cap ?? null;
  return {
    used,
    orders: mine.length,
    cap,
    remaining: cap == null ? null : Math.max(cap - used, 0),
    max_pct: org?.staff_discount_max_pct ?? 0,
    pin_threshold: org?.staff_discount_pin_threshold ?? null,
  };
}

/** True when the employee has clocked in today — the demo mirror of the time_entries check in 0070. */
function demoWorkedToday(orgId: string, employeeId: string): boolean {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return dTimeEntries
    .list({ org_id: orgId, employee_id: employeeId } as Partial<TimeEntry>)
    .some((e) => new Date(e.clock_in) >= dayStart);
}

/** Demo-mode mirror of staff_meal_usage (0070) — today's allowance, not this month's. */
function demoMealUsage(orgId: string, employeeId: string): StaffMealUsage {
  const org = dOrgs.get(orgId);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const mine = dOrders
    .list({ org_id: orgId } as Partial<Order>)
    .filter(
      (o) =>
        o.staff_discount_employee_id === employeeId &&
        (o.staff_meal_amount ?? 0) > 0 &&
        o.status !== "void" &&
        o.status !== "refunded" &&
        new Date(o.created_at) >= dayStart,
    );
  const used = +mine.reduce((s, o) => s + (o.staff_meal_amount ?? 0), 0).toFixed(2);
  const drinksUsed = mine.reduce((s, o) => s + (o.staff_meal_drinks ?? 0), 0);
  const limit = org?.staff_meal_daily_limit ?? null;
  const offPct = org?.staff_meal_pct_off ?? null;
  // An off-day rate is what switches the working-day rule on; without it every day counts as a working day.
  const working = offPct == null ? true : demoWorkedToday(orgId, employeeId);
  const freeDrinks = org?.staff_meal_free_drinks ?? null;
  return {
    used,
    orders: mine.length,
    limit,
    remaining: !working || limit == null || limit <= 0 ? 0 : Math.max(limit - used, 0),
    working_today: working,
    pct: working ? (org?.staff_meal_pct_working ?? org?.staff_discount_max_pct ?? 0) : (offPct ?? 0),
    drinks_used: drinksUsed,
    drinks_limit: freeDrinks,
    drinks_remaining: freeDrinks == null ? null : Math.max(freeDrinks - drinksUsed, 0),
  };
}

/** Today's remaining staff-meal allowance for one employee. */
export async function getStaffMealUsage(orgId: string, employeeId: string): Promise<StaffMealUsage> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return demoMealUsage(orgId, employeeId);
  }
  const { data, error } = await getSupabase().rpc("staff_meal_usage", { _org: orgId, _employee: employeeId });
  if (error) throw error;
  return data as StaffMealUsage;
}

/** The demo has no auth users to tell apart, so every demo claim is by this one partner (matches DEMO_USER in useAuth). */
const DEMO_PARTNER_ID = "demo-user";

/** Demo-mode mirror of partner_meal_usage (0070): this calendar month, voided/refunded meals don't count. */
function demoPartnerUsage(orgId: string): PartnerMealUsage {
  const org = dOrgs.get(orgId);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const used = dOrders
    .list({ org_id: orgId } as Partial<Order>)
    .filter(
      (o) =>
        o.partner_meal_user_id === DEMO_PARTNER_ID &&
        o.status !== "void" &&
        o.status !== "refunded" &&
        new Date(o.created_at) >= monthStart,
    ).length;
  const count = org?.partner_meal_monthly_count ?? null;
  return {
    eligible: true,
    count,
    max_value: org?.partner_meal_max_value ?? null,
    used,
    remaining: count == null || count <= 0 ? 0 : Math.max(count - used, 0),
  };
}

/** The signed-in partner's free meals this month. */
export async function getPartnerMealUsage(orgId: string): Promise<PartnerMealUsage> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return demoPartnerUsage(orgId);
  }
  const { data, error } = await getSupabase().rpc("partner_meal_usage", { _org: orgId });
  if (error) throw error;
  return data as PartnerMealUsage;
}

/** Per-employee staff-meal totals over a date range (null bounds = all time). */
export async function getStaffMealReport(
  orgId: string,
  from?: string | null,
  to?: string | null,
): Promise<StaffMealReportRow[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const employees = demoTable<Employee>("employees");
    const byEmployee = new Map<string, StaffMealReportRow>();
    for (const o of dOrders.list({ org_id: orgId } as Partial<Order>)) {
      const id = o.staff_discount_employee_id;
      const mealAmount = o.staff_meal_amount ?? 0;
      if (!id || mealAmount <= 0 || o.status === "void" || o.status === "refunded") continue;
      if (from && o.created_at < from) continue;
      if (to && o.created_at >= to) continue;
      const e = employees.get(id);
      const row =
        byEmployee.get(id) ??
        {
          employee_id: id,
          employee_name: e?.name ?? "Unknown",
          role_title: e?.role_title ?? "",
          orders: 0, meal_amount: 0, discounted_amount: 0, revenue: 0,
        };
      row.orders += 1;
      row.meal_amount = +(row.meal_amount + mealAmount).toFixed(2);
      row.discounted_amount = +(row.discounted_amount + (o.staff_discount_amount ?? 0)).toFixed(2);
      row.revenue = +(row.revenue + o.total).toFixed(2);
      byEmployee.set(id, row);
    }
    return [...byEmployee.values()].sort((a, b) => b.meal_amount - a.meal_amount);
  }
  const { data, error } = await getSupabase().rpc("staff_meal_report", {
    _org: orgId,
    _from: from ?? null,
    _to: to ?? null,
  });
  if (error) throw error;
  return (data as StaffMealReportRow[]) ?? [];
}

/** Throws with the same messages the RPC raises, so the POS shows one wording in both modes. */
function assertStaffDiscountAllowed(
  orgId: string,
  employeeId: string,
  discount: number,
  gross: number,
  approvalPin: string | null,
) {
  const org = dOrgs.get(orgId);
  const maxPct = org?.staff_discount_max_pct ?? 0;
  if (maxPct <= 0) throw new Error("staff discount is not enabled for this restaurant");

  const employee = demoTable<Employee>("employees").get(employeeId);
  if (!employee || !employee.is_active) throw new Error("staff discount: employee not found or inactive");
  if (discount <= 0) throw new Error("staff discount: no discount amount given");

  const pctOfGross = gross > 0 ? (discount * 100) / gross : 0;
  if (+pctOfGross.toFixed(2) > maxPct) {
    throw new Error(
      `staff discount of ${pctOfGross.toFixed(1)} percent exceeds the limit of ${maxPct} percent`,
    );
  }

  const usage = demoStaffUsage(orgId, employeeId);
  if (usage.cap != null && usage.used + discount > usage.cap) {
    throw new Error(
      `staff discount: ${employee.name} has only ${(usage.remaining ?? 0).toFixed(2)} left of a ${usage.cap} monthly limit`,
    );
  }

  const threshold = org?.staff_discount_pin_threshold ?? null;
  if (threshold != null && discount > threshold) {
    const approver = demoTable<Employee>("employees")
      .list({ org_id: orgId } as Partial<Employee>)
      .some((e) => e.is_active && e.can_approve_discounts && e.pin && e.pin === approvalPin);
    if (!approver) throw new Error(`staff discount over ${threshold} needs a manager PIN`);
  }
}

/** This month's remaining staff-discount allowance for one employee. */
export async function getStaffDiscountUsage(orgId: string, employeeId: string): Promise<StaffDiscountUsage> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return demoStaffUsage(orgId, employeeId);
  }
  const { data, error } = await getSupabase().rpc("staff_discount_usage", {
    _org: orgId,
    _employee: employeeId,
  });
  if (error) throw error;
  return data as StaffDiscountUsage;
}

/** Per-employee staff-discount totals over a date range (null bounds = all time). */
export async function getStaffDiscountReport(
  orgId: string,
  from?: string | null,
  to?: string | null,
): Promise<StaffDiscountReportRow[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const employees = demoTable<Employee>("employees");
    const byEmployee = new Map<string, StaffDiscountReportRow>();
    for (const o of dOrders.list({ org_id: orgId } as Partial<Order>)) {
      const id = o.staff_discount_employee_id;
      if (!id || o.status === "void" || o.status === "refunded") continue;
      if (from && o.created_at < from) continue;
      if (to && o.created_at >= to) continue;
      const e = employees.get(id);
      const row =
        byEmployee.get(id) ??
        {
          employee_id: id,
          employee_name: e?.name ?? "Unknown",
          role_title: e?.role_title ?? "",
          orders: 0, discount_given: 0, revenue: 0, guests: 0,
        };
      row.orders += 1;
      row.discount_given = +(row.discount_given + (o.staff_discount_amount ?? 0)).toFixed(2);
      row.revenue = +(row.revenue + o.total).toFixed(2);
      byEmployee.set(id, row);
    }
    // `guests` is a distinct-customer count; recompute it once rather than
    // trying to accumulate distinctness in the loop above.
    for (const [id, row] of byEmployee) {
      row.guests = new Set(
        dOrders
          .list({ org_id: orgId } as Partial<Order>)
          .filter((o) => o.staff_discount_employee_id === id && o.customer_id)
          .map((o) => o.customer_id),
      ).size;
    }
    return [...byEmployee.values()].sort((a, b) => b.discount_given - a.discount_given);
  }
  const { data, error } = await getSupabase().rpc("staff_discount_report", {
    _org: orgId,
    _from: from ?? null,
    _to: to ?? null,
  });
  if (error) throw error;
  return (data as StaffDiscountReportRow[]) ?? [];
}

/** The live-data engine: order + payments + inventory depletion + loyalty, atomically. */
export async function checkoutOrder(orgId: string, payload: CheckoutPayload): Promise<CheckoutResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.get(orgId);
    const taxRate = org?.tax_rate ?? 8.5;
    // Snapshot each line's rate now — the recipe's setting may change later, but the
    // receipt must always show what was actually charged (see 0032 migration).
    const items: OrderLine[] = payload.items.map((l) => {
      const rate = dRecipes.get(l.recipe_id)?.tax_rate;
      return rate == null ? l : { ...l, tax_rate: rate };
    });
    // VAT-included (gross) pricing: menu prices already include VAT. Break it out
    // of the price rather than adding on top; store subtotal NET (see 0017 migration).
    const gross = items.reduce((s, l) => s + l.price * l.qty, 0);
    let discount = Math.min(
      Math.max(payload.discountAmount ?? 0, 0) + gross * (Math.max(payload.discountPct ?? 0, 0) / 100),
      gross,
    );
    // Same allowance checks the RPC runs — the demo has no server to enforce
    // them, so it has to reject the same things or the two modes disagree.
    const staffId = payload.staffDiscountEmployeeId ?? null;
    let mealAmount = 0;
    let mealDrinks = 0;
    let partnerAmount = 0;
    if (payload.partnerMeal) {
      // Same rules as checkout_order (0070): one of this month's free meals, free up to the optional cap,
      // refused once they're used. Overrides any manual discount sent.
      if (staffId) throw new Error("a partner meal can't be combined with a staff discount or staff meal");
      const usage = demoPartnerUsage(orgId);
      if ((usage.count ?? 0) <= 0) throw new Error("partner meals are not enabled for this restaurant");
      if (usage.remaining <= 0) {
        throw new Error(`no free partner meals left this month (${usage.used} of ${usage.count} used)`);
      }
      partnerAmount = +Math.min(gross, usage.max_value ?? gross).toFixed(2);
      discount = partnerAmount;
    }
    if (staffId) {
      if (payload.mealPin) {
        // Staff meal/drink claim (0048): own-PIN identity check, then free up
        // to the remaining daily allowance and the staff-discount rate on
        // whatever's left — overrides any manual discountAmount/Pct sent.
        const employee = demoTable<Employee>("employees").get(staffId);
        if (!employee || employee.pin == null || employee.pin !== payload.mealPin) {
          throw new Error("PIN doesn't match — enter your own PIN to confirm it's you");
        }
        const dailyLimit = org?.staff_meal_daily_limit ?? 0;
        if (dailyLimit <= 0) throw new Error("staff meals are not enabled for this restaurant");
        // Same rules as checkout_order (0070): free credit first (food, plus up to N drinks a day),
        // then the working-day rate on the rest; a day off is the off-day rate and no credit.
        const usage = demoMealUsage(orgId, staffId);
        const mealLines: MealLine[] = payload.items.map((l) => ({
          price: l.price,
          qty: l.qty,
          category: dRecipes.get(l.recipe_id)?.category,
        }));
        const quote = quoteStaffMeal(mealLines, {
          working: usage.working_today ?? true,
          credit: usage.remaining,
          drinksLeft: usage.drinks_remaining ?? null,
          pct: usage.pct ?? 0,
        });
        mealAmount = quote.free;
        mealDrinks = quote.freeDrinks;
        discount = quote.discount;
      } else {
        assertStaffDiscountAllowed(orgId, staffId, discount, gross, payload.approvalPin ?? null);
      }
    }
    const discountedGross = +(gross - discount).toFixed(2);
    const tax = sumTax(computeTaxGroups(items, taxRate, discount));
    const tip = payload.tip ?? 0;
    const total = +(discountedGross + tip).toFixed(2);
    const subtotal = +(discountedGross - tax).toFixed(2);
    const orderNumber = `ORD-${String(dOrders.list({ org_id: orgId } as Partial<Order>).length + 1).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const order: Order = {
      id: uid(), org_id: orgId, order_number: orderNumber, order_type: payload.orderType,
      table_id: payload.tableId ?? null, customer_id: payload.customerId ?? null, guest_name: null,
      items, subtotal, tax, tip, total, discount: +discount.toFixed(2),
      status: payload.payments.length > 0 ? "paid" : "open",
      kitchen_status: "new", kitchen_notes: payload.kitchenNotes ?? null, source: "pos", created_at: now,
      employee_id: payload.employeeId ?? null,
      staff_discount_employee_id: staffId,
      staff_discount_amount: staffId ? +(discount - mealAmount).toFixed(2) : 0,
      staff_meal_amount: +mealAmount.toFixed(2),
      staff_meal_drinks: mealDrinks,
      partner_meal_user_id: payload.partnerMeal ? DEMO_PARTNER_ID : null,
      partner_meal_amount: partnerAmount,
    };
    dOrders.insert(order);
    for (const p of payload.payments) {
      dPayments.insert({
        id: uid(), org_id: orgId, order_id: order.id, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null, created_at: now,
      });
    }
    // Inventory depletion via linked ingredients
    const usage = new Map<string, { used: number; name: string }>();
    for (const line of payload.items) {
      for (const ing of dIngredients.list({ recipe_id: line.recipe_id } as Partial<RecipeIngredient>)) {
        if (!ing.inventory_item_id || ing.qty_numeric <= 0) continue;
        const prev = usage.get(ing.inventory_item_id) ?? { used: 0, name: ing.name };
        prev.used += ing.qty_numeric * line.qty;
        usage.set(ing.inventory_item_id, prev);
      }
    }
    for (const [itemId, u] of usage) {
      const item = dItems.get(itemId);
      if (!item) continue;
      const newStock = Math.max(0, +(item.stock - u.used).toFixed(3));
      dItems.update(itemId, { stock: newStock });
      dTx.insert({
        id: uid(), org_id: orgId, item_id: itemId, item_name: item.name, delta: -u.used,
        reason: mealAmount > 0 || partnerAmount > 0 ? "staff_meal" : "sale", waste_reason: null, ref_order_id: order.id, note: null, created_at: now,
      });
      if (newStock < item.par_level * 0.5 && item.stock >= item.par_level * 0.5) {
        pushDemoNotification(
          orgId, "low_stock", `Low stock: ${item.name}`,
          `Only ${newStock} ${item.unit} left (par ${item.par_level})`, "inventory",
        );
      }
    }
    pushDemoAudit(orgId, "orders", "INSERT", order.id, { order_number: orderNumber });
    // Table + delivery side effects
    if (payload.tableId) {
      demoTable<{ id: string; status: string }>("restaurant_tables").update(payload.tableId, { status: "seated" });
    }
    if (payload.orderType === "delivery") {
      demoTable<Delivery>("deliveries").insert({
        id: uid(), org_id: orgId, order_id: order.id, courier_employee_id: null,
        address: payload.address ?? "", phone: null, status: "pending", eta: null,
        notes: null, created_at: now, updated_at: now, created_by: null,
        postcode: null, delivery_fee: 0, current_lat: null, current_lng: null,
        location_updated_at: null,
      });
    }
    // Loyalty
    if (payload.customerId) {
      const c = dCustomers.get(payload.customerId);
      if (c) {
        const newSpend = c.total_spend + total;
        dCustomers.update(c.id, {
          visits: c.visits + 1,
          total_spend: +newSpend.toFixed(2),
          points: c.points + Math.floor(total),
          last_visit_at: now,
          tier: newSpend >= 2000 ? "Platinum" : newSpend >= 1000 ? "Gold" : newSpend >= 400 ? "Silver" : "Bronze",
        });
      }
    }
    return { order_id: order.id, order_number: orderNumber, total, discount: +discount.toFixed(2) };
  }

  // With a TSE configured, checkout goes through the server so the completed
  // order can be signed before the till hears back — a Postgres function can't
  // call the TSE itself. Without one, nothing changes: the RPC is called
  // directly, exactly as before.
  if (isTseEnabledForOrg(payload.org)) {
    const res = await fetch("/api/pos/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_id: orgId, payload }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Checkout failed.");
    return body as CheckoutResult;
  }

  const { data, error } = await getSupabase().rpc("checkout_order", {
    _org: orgId,
    _items: payload.items,
    _order_type: payload.orderType,
    _table_id: payload.tableId ?? null,
    _customer_id: payload.customerId ?? null,
    _kitchen_notes: payload.kitchenNotes ?? null,
    _tip: payload.tip ?? 0,
    _payments: payload.payments,
    _address: payload.address ?? null,
    _discount_amount: payload.discountAmount ?? 0,
    _discount_pct: payload.discountPct ?? 0,
    _employee_id: payload.employeeId ?? null,
    _staff_employee_id: payload.staffDiscountEmployeeId ?? null,
    _approval_pin: payload.approvalPin ?? null,
    _meal_pin: payload.mealPin ?? null,
    // Only sent when it's actually a partner meal: an older database (migration 0070 not run yet) has no such
    // argument, and sending it unconditionally would make every ordinary checkout fail until it is.
    ...(payload.partnerMeal ? { _partner_meal: true } : {}),
  });
  if (error) throw error;
  return data as CheckoutResult;
}

/**
 * Change an order's status — used to Void (cancel/mis-ring) or Refund a paid
 * order. The record is kept (never deleted), so history and audit stay intact;
 * void/refunded orders are simply excluded from takings and revenue reports.
 */
export async function setOrderStatus(
  orgId: string,
  orderId: string,
  status: OrderStatus,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(orderId, { status });
    pushDemoAudit(orgId, "orders", "UPDATE", orderId, { status });
    return;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ status })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Demo mode has no DB trigger, so mirror stamp_kitchen_times() from migration 0057 here. */
function demoKitchenStamps(order: Order | undefined, status: KitchenStatus): Partial<Order> {
  const now = new Date().toISOString();
  const out: Partial<Order> = {};
  if (status !== "new" && !order?.kitchen_started_at) out.kitchen_started_at = now;
  if ((status === "ready" || status === "served") && !order?.kitchen_ready_at) out.kitchen_ready_at = now;
  if (status === "served" && !order?.kitchen_served_at) out.kitchen_served_at = now;
  return out;
}

export async function setKitchenStatus(orgId: string, orderId: string, status: KitchenStatus): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(orderId, { kitchen_status: status, ...demoKitchenStamps(dOrders.get(orderId), status) });
    return;
  }
  const { error } = await getSupabase()
    .from("orders")
    .update({ kitchen_status: status })
    .eq("id", orderId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/**
 * Mark one line of a ticket ready (or undo it). The ticket follows along:
 * first ready line → Preparing, every line ready → Ready to Serve (which is
 * what notifies service), un-marking a line pulls a Ready ticket back to
 * Preparing. Returns the ticket's resulting kitchen status.
 */
export async function setLineReady(
  orgId: string,
  order: Order,
  lineIndex: number,
  ready: boolean,
): Promise<KitchenStatus> {
  const items = order.items.map((l, i) => (i === lineIndex ? { ...l, ready } : l));
  const all = items.every((l) => l.ready);
  const any = items.some((l) => l.ready);
  let status = order.kitchen_status;
  if (all) status = "ready";
  else if (status === "ready") status = "preparing";
  else if (any && status === "new") status = "preparing";
  const patch = { items, kitchen_status: status };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dOrders.update(order.id, { ...patch, ...demoKitchenStamps(order, status) });
    return status;
  }
  const { error } = await getSupabase().from("orders").update(patch).eq("id", order.id).eq("org_id", orgId);
  if (error) throw error;
  return status;
}

/**
 * Settle an open order (e.g. a dine-in tab where the waiter took the order and
 * the guest pays after eating). Records the payment(s) and flips status to paid.
 * Pass `tip` to add a gratuity at settle time — the order's tip/total are
 * updated so Z-reports and analytics stay consistent.
 */
export async function markOrderPaid(
  orgId: string,
  orderId: string,
  payments: CheckoutPayload["payments"],
  tip?: number,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const now = new Date().toISOString();
    for (const p of payments) {
      dPayments.insert({
        id: uid(), org_id: orgId, order_id: orderId, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null, created_at: now,
      });
    }
    const order = dOrders.get(orderId);
    const patch: Partial<Order> = { status: "paid" };
    if (tip != null && order) {
      patch.tip = +tip.toFixed(2);
      patch.total = +(order.subtotal + order.tax + tip).toFixed(2);
    }
    dOrders.update(orderId, patch);
    return;
  }
  const sb = getSupabase();
  if (payments.length) {
    const { error } = await sb.from("payments").insert(
      payments.map((p) => ({
        org_id: orgId, order_id: orderId, method: p.method, amount: p.amount,
        tip_amount: p.tip_amount ?? 0, split_label: p.split_label ?? null,
      })),
    );
    if (error) throw error;
  }
  const patch: Record<string, unknown> = { status: "paid" };
  if (tip != null) {
    const { data: ord, error: readErr } = await sb
      .from("orders")
      .select("subtotal, tax")
      .eq("id", orderId)
      .eq("org_id", orgId)
      .single();
    if (readErr) throw readErr;
    patch.tip = +tip.toFixed(2);
    patch.total = +((ord?.subtotal ?? 0) + (ord?.tax ?? 0) + tip).toFixed(2);
  }
  const { error } = await sb.from("orders").update(patch).eq("id", orderId).eq("org_id", orgId);
  if (error) throw error;
}
