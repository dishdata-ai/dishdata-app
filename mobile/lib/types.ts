import type { ProdMethod } from "@/lib/kitchen-standards";
// Hand-maintained row types mirroring supabase/setup.sql.
// Keep this file and setup.sql in sync when the schema changes.

export type Role = "owner" | "admin" | "partner" | "manager" | "staff" | "accountant" | "viewer";
export type OrderType = "dine_in" | "takeaway" | "delivery";
export type OrderStatus = "open" | "paid" | "void" | "refunded";
export type KitchenStatus = "new" | "preparing" | "ready" | "served";
export type PaymentMethod = "card" | "cash" | "wallet" | "stripe";
export type PoStatus = "draft" | "sent" | "confirmed" | "delivered" | "reconciled";
export type InvReason = "sale" | "purchase" | "waste" | "adjustment" | "count";
export type WasteReason = "spoiled" | "burnt" | "returned" | "overprep" | "other";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type ReservationStatus = "booked" | "seated" | "completed" | "no_show" | "cancelled";
export type DeliveryStatus = "pending" | "assigned" | "picked_up" | "delivered" | "failed";
export type TableStatus = "open" | "seated" | "reserved" | "cleaning";
export type CampaignStatus = "draft" | "scheduled" | "sent";
export type CampaignChannel = "email" | "sms" | "in_store";
export type LoyaltyTierBasis = "lifetime" | "rolling_12mo" | "spend";
export type LoyaltyActionType =
  | "purchase" | "signup" | "birthday" | "instagram_follow"
  | "newsletter" | "review" | "referral" | "visit" | "custom";
export type LoyaltyRewardType =
  | "free_item" | "amount_discount" | "percent_discount" | "free_delivery" | "custom";
export type LoyaltyRedemptionStatus = "issued" | "applied" | "expired" | "void";
export type LoyaltyVerification = "auto" | "honor" | "verified";

export interface Org {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  accent_color: string | null;
  currency: string;
  tax_rate: number;
  target_food_cost_pct: number;
  onboarding_completed: boolean;
  settings: Record<string, unknown>;
  /** € of free staff meal per employee per day. null/0 = staff meals off. */
  staff_meal_daily_limit?: number | null;
  /** % off the rest of a staff meal on a day the employee clocked in. */
  staff_meal_pct_working?: number | null;
  /** % off a staff meal on a day they did not clock in (no free credit that day). */
  staff_meal_pct_off?: number | null;
  /** Most drinks the free credit may cover per day. null = no cap. */
  staff_meal_free_drinks?: number | null;
  /** Where people may clock in from. All three set = a geofence; any missing = no location check. */
  clockin_lat?: number | null;
  clockin_lng?: number | null;
  clockin_radius_m?: number | null;
  /** Free meals per partner per month. null/0 = partner meals off. */
  partner_meal_monthly_count?: number | null;
  partner_meal_max_value?: number | null;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  active_org_id: string | null;
  preferences: Record<string, unknown>;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  // joined fields
  email?: string | null;
  full_name?: string | null;
}

export interface ModuleAccess {
  org_id: string;
  user_id: string;
  module_id: string;
  can_access: boolean;
}

export interface Invite {
  id: string;
  org_id: string;
  email: string;
  role: Role;
  code: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface Vendor {
  id: string;
  org_id: string;
  name: string;
  category: string;
  contact_email: string | null;
  contact_phone: string | null;
  rating: number;
  on_time_pct: number;
  monthly_spend: number;
  price_index: number;
}

export type ItemType = "ingredient" | "supply" | "equipment";
export type AssetStatus = "in_service" | "maintenance" | "retired";

export interface InventoryItem {
  id: string;
  org_id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  par_level: number;
  unit_cost: number;
  expires_at: string | null;
  vendor_id: string | null;
  // Multi-type + location + labeling
  item_type: ItemType;
  sku: string | null;
  location_id: string | null;
  // Equipment-only (null for consumables)
  serial_number: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  depreciation_months: number | null;
  asset_status: AssetStatus | null;
  grams_per_unit: number | null;
}

export interface StorageLocation {
  id: string;
  org_id: string;
  name: string;
  area: string;
  shelf: string;
  notes: string | null;
}

export type MaintenanceKind = "service" | "repair" | "inspection";

export interface AssetMaintenance {
  id: string;
  org_id: string;
  item_id: string;
  performed_at: string;
  kind: MaintenanceKind;
  cost: number;
  note: string | null;
  next_due_at: string | null;
  created_at: string;
}

export interface InventoryTransaction {
  id: string;
  org_id: string;
  item_id: string | null;
  item_name: string;
  delta: number;
  reason: InvReason;
  waste_reason: WasteReason | null;
  ref_order_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Recipe {
  id: string;
  org_id: string;
  name: string;
  category: string;
  price: number;
  prep_minutes: number;
  emoji: string;
  image_url: string | null;
  is_active: boolean;
}

export interface RecipeIngredient {
  id: string;
  org_id: string;
  recipe_id: string;
  inventory_item_id: string | null;
  name: string;
  qty_display: string;
  qty_numeric: number;
  cost: number;
  unit: string | null;
  yield_pct: number;
  cost_override: number | null;
}

export interface PurchaseOrder {
  id: string;
  org_id: string;
  po_number: string;
  vendor_id: string | null;
  vendor_name: string;
  status: PoStatus;
  expected_at: string;
  total: number;
  items_count: number;
  created_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  org_id: string;
  po_id: string;
  inventory_item_id: string | null;
  name: string;
  qty: number;
  unit_cost: number;
}

export type PriceSource = "manual" | "po" | "invoice";
export type BillStatus = "parsed" | "reviewed" | "confirmed";

/** One observed price for an item from a vendor at a point in time. */
export interface SupplierItemPrice {
  id: string;
  org_id: string;
  inventory_item_id: string | null;
  vendor_id: string | null;
  item_name: string;
  vendor_name: string;
  price: number;
  unit: string | null;
  pack_qty: number;
  source: PriceSource;
  bill_item_id: string | null;
  po_item_id: string | null;
  effective_from: string;
  created_at: string;
}

export interface SupplierBill {
  id: string;
  org_id: string;
  vendor_id: string | null;
  vendor_name: string;
  bill_date: string | null;
  total: number;
  image_url: string | null;
  status: BillStatus;
  raw_extract: unknown;
  created_at: string;
}

export interface SupplierBillItem {
  id: string;
  org_id: string;
  bill_id: string;
  inventory_item_id: string | null;
  raw_name: string;
  qty: number;
  unit: string | null;
  unit_price: number;
}

export interface RestaurantTable {
  id: string;
  org_id: string;
  name: string;
  seats: number;
  zone: string;
  status: TableStatus;
}

export interface Customer {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  visits: number;
  total_spend: number;
  points: number;
  tier: string;
  last_visit_at: string | null;
  // Loyalty (DB-defaulted columns — optional on the client so existing inserts stay valid)
  birthday?: string | null;
  status_points?: number;
  tier_id?: string | null;
  newsletter_opt_in?: boolean;
  instagram_handle?: string | null;
}

export interface OrderLine {
  recipe_id: string;
  name: string;
  qty: number;
  price: number;
  /** Kitchen marked this line ready (item-by-item hand-over). Absent = not yet. */
  ready?: boolean;
}

export interface Order {
  id: string;
  org_id: string;
  order_number: string;
  order_type: OrderType;
  table_id: string | null;
  customer_id: string | null;
  guest_name: string | null;
  items: OrderLine[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  status: OrderStatus;
  kitchen_status: KitchenStatus;
  kitchen_notes: string | null;
  source: string;
  created_at: string;
  /** Stamped by the database when the ticket changes kitchen status (web migration 0057). */
  kitchen_started_at?: string | null;
  kitchen_ready_at?: string | null;
  kitchen_served_at?: string | null;
  // Discounts and meal claims (web migrations 0033 / 0048 / 0070). Optional so older rows and demo data still fit.
  discount?: number;
  employee_id?: string | null;
  staff_discount_employee_id?: string | null;
  staff_discount_amount?: number;
  staff_meal_amount?: number;
  staff_meal_drinks?: number;
  partner_meal_user_id?: string | null;
  partner_meal_amount?: number;
}

export interface Payment {
  id: string;
  org_id: string;
  order_id: string;
  method: PaymentMethod;
  amount: number;
  tip_amount: number;
  split_label: string | null;
  created_at: string;
}

export interface Reservation {
  id: string;
  org_id: string;
  table_id: string | null;
  customer_id: string | null;
  guest_name: string;
  phone: string | null;
  party_size: number;
  starts_at: string;
  duration_min: number;
  status: ReservationStatus;
  note: string | null;
  source: string;
}

export interface Delivery {
  id: string;
  org_id: string;
  order_id: string | null;
  courier_employee_id: string | null;
  address: string;
  phone: string | null;
  status: DeliveryStatus;
  eta: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Added in 0010_delivery_tracking.sql — server-validated fee/postcode and
  // the rider's live position for get_public_order_status/report_courier_location.
  postcode: string | null;
  delivery_fee: number;
  current_lat: number | null;
  current_lng: number | null;
  location_updated_at: string | null;
}

export interface Employee {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  role_title: string;
  hourly_rate: number;
  pin: string | null;
  shift_note: string | null;
  avatar_hue: number;
  is_active: boolean;
}

export interface TimeEntry {
  id: string;
  org_id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  break_seconds: number;
  break_started_at: string | null;
  note: string | null;
}

export interface Task {
  id: string;
  org_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_employee_id: string | null;
  partner_email: string | null;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  // Daily checklists (web migrations 0055/0056). All optional so older rows and demo data still type-check.
  is_daily?: boolean;
  is_partner_task?: boolean;
  assigned_role?: StaffRole | null;
  requires_photo?: boolean;
  example_photo_url?: string | null;
  proof_photos?: TaskPhoto[];
  checklist?: ChecklistItem[];
}

export type StaffRole =
  | "frontend"
  | "frontend_helper"
  | "kitchen_lead"
  | "commi_kitchen"
  | "kitchen_helper"
  | "owner"
  | "admin"
  | "manager";

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskPhoto {
  id: string;
  url: string;
  by: string | null;
  at: string;
}

/** Who holds a duty (a person is either a staff record or a login, never both). */
export interface DutyAssignment {
  id: string;
  org_id: string;
  duty: StaffRole;
  employee_id: string | null;
  user_id: string | null;
}

/** Today's staff-meal allowance for one employee (staff_meal_usage RPC, migration 0070). */
export interface StaffMealUsage {
  used: number;
  orders: number;
  limit: number | null;
  /** Free € left today; 0 on a day the employee hasn't clocked in. */
  remaining: number;
  working_today?: boolean;
  /** % off whatever the free credit doesn't cover, today. */
  pct?: number;
  drinks_remaining?: number | null;
}

/** This calendar month's free partner meals (partner_meal_usage RPC, migration 0070). */
export interface PartnerMealUsage {
  eligible: boolean;
  count: number | null;
  max_value: number | null;
  used: number;
  remaining: number;
}

export interface Campaign {
  id: string;
  org_id: string;
  name: string;
  channel: CampaignChannel;
  segment: { tier?: string; min_visits?: number; inactive_days?: number };
  status: CampaignStatus;
  scheduled_at: string | null;
  stats: { sent?: number; opened?: number; redeemed?: number };
  created_at: string;
}

export interface Expense {
  id: string;
  org_id: string;
  date: string;
  category: string;
  vendor_name: string;
  amount: number;
  tax_amount: number;
  receipt_url: string | null;
  note: string | null;
}

export interface LoyaltyProgram {
  org_id: string;
  enabled: boolean;
  points_name: string;
  earn_rate: number;
  redeem_rate: number;
  tier_basis: LoyaltyTierBasis;
  rolling_window_days: number;
  points_expiry_days: number | null;
  settings: Record<string, unknown>;
}

export interface LoyaltyTierPerks {
  earn_multiplier?: number;
  free_delivery?: boolean;
  birthday_bonus?: number;
  custom?: string[];
}

export interface LoyaltyTier {
  id: string;
  org_id: string;
  name: string;
  threshold: number;
  sort_order: number;
  color: string | null;
  icon: string | null;
  perks: LoyaltyTierPerks;
  created_at: string;
}

export interface LoyaltyEarnRule {
  id: string;
  org_id: string;
  action_type: LoyaltyActionType;
  label: string;
  description: string | null;
  points: number;
  enabled: boolean;
  verification: LoyaltyVerification;
  repeatable: boolean;
  cooldown_days: number | null;
  config: Record<string, unknown>;
  created_at: string;
}

export interface LoyaltyReward {
  id: string;
  org_id: string;
  reward_type: LoyaltyRewardType;
  label: string;
  description: string | null;
  cost_points: number;
  value: number;
  free_recipe_id: string | null;
  min_tier_id: string | null;
  enabled: boolean;
  image_url: string | null;
  sort_order: number;
  created_at: string;
}

export interface LoyaltyRedemption {
  id: string;
  org_id: string;
  customer_id: string;
  reward_id: string | null;
  reward_snapshot: Record<string, unknown>;
  points_spent: number;
  code: string;
  status: LoyaltyRedemptionStatus;
  expires_at: string | null;
  applied_order_id: string | null;
  created_at: string;
}

export interface LoyaltyTransaction {
  id: string;
  org_id: string;
  customer_id: string;
  points_delta: number;
  reason: string;
  order_id: string | null;
  action_type: LoyaltyActionType | null;
  created_at: string;
}

export interface Notification {
  id: string;
  org_id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string | null;
  ref: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  org_id: string;
  actor: string | null;
  table_name: string;
  action: string;
  row_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface EventMenu {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  /** Public storefront shows this menu instead of the full catalog. */
  show_on_website: boolean;
  /** Food is pre-prepared: POS marks orders served, skipping the kitchen board. */
  skip_kitchen: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface EventMenuItem {
  id: string;
  org_id: string;
  event_menu_id: string;
  recipe_id: string;
  created_at: string;
}

export type AvailabilityStatus = "available" | "partial" | "unavailable";

/** One person's say-so about one day. No row means "hasn't said", which is not the same as unavailable. */
export interface StaffAvailability {
  id: string;
  org_id: string;
  employee_id: string;
  /** YYYY-MM-DD */
  day: string;
  status: AvailabilityStatus;
  from_time: string | null;
  to_time: string | null;
  note: string | null;
  updated_at: string;
}

/** A shift a manager assigned. end_time may be earlier than start_time for an overnight shift. */
export interface Shift {
  id: string;
  org_id: string;
  employee_id: string;
  /** YYYY-MM-DD */
  day: string;
  /** "HH:MM:SS" (Postgres time) */
  start_time: string;
  end_time: string;
  role_title: string | null;
  note: string | null;
  updated_at: string;
}

// Kitchen Ops (web migration 0059): one row per production component and a log of cooked / wasted / stock-out events.
export interface KitchenDish {
  id: string;
  org_id: string;
  recipe_id: string | null;
  dish: string;
  /** Comma-separated lowercase fragments that mark an order line as this dish. */
  terms: string;
  method: ProdMethod;
  bain_marie: "yes" | "limited" | "no";
  open_pct: number;
  portion: string;
  portion_g: number | null;
  frozen: boolean;
  station: string;
  container: string;
  batch_portions: number;
  min_portions: number;
  reorder_at: number;
  prep_minutes: number;
  finish_minutes: number;
  target_wait_min: number;
  hold_temp_c: number | null;
  max_hold_min: number | null;
  notes: string;
  /** Live: portions in the bain-marie / hot box. */
  hot_portions: number;
  /** Live: portions (or prepped components) in the fridge — the freezer for frozen items. */
  fridge_portions: number;
  position: number;
  is_active: boolean;
  updated_at: string;
  updated_by: string | null;
}

export type KitchenLogKind = "cooked" | "wasted" | "stockout";

export interface KitchenLogEntry {
  id: string;
  org_id: string;
  dish: string;
  kind: KitchenLogKind;
  portions: number;
  value: number;
  reason: string | null;
  created_at: string;
  created_by: string | null;
}

// Sales Channels inbox (web migrations for channel_orders): orders pushed in by Wolt / Uber Eats / Lieferando / SumUp.
export type ChannelProvider = "ubereats" | "wolt" | "lieferando" | "sumup";
export type ChannelOrderStatus = "pending" | "accepted" | "rejected" | "failed";

export interface ChannelOrderLine {
  name: string;
  qty: number;
  price: number;
  recipe_id: string | null;
  notes?: string | null;
}

export interface ChannelOrder {
  id: string;
  org_id: string;
  channel_id: string;
  provider: ChannelProvider;
  external_id: string;
  external_display_id: string;
  status: ChannelOrderStatus;
  order_id: string | null;
  items: ChannelOrderLine[];
  gross: number;
  customer_name: string;
  order_type: OrderType;
  notes: string | null;
  reject_reason: string | null;
  received_at: string;
  decided_at: string | null;
}

// Event preorders (web migrations for preorder_events / preorder_orders).
export type PreorderStatus = "confirmed" | "cancelled";

export interface PreorderEvent {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  /** The days this event serves, as YYYY-MM-DD. Drives the date tabs, so an empty service date still shows. */
  service_dates: string[];
  slot_minutes: number;
  day_start_hour: number;
  /** Exclusive — 11..22 means eleven hourly slots, the last starting at 21:00. */
  day_end_hour: number;
  /** Covers seatable in any one slot. */
  dine_in_capacity: number;
  /** Shared secret for this event's website-form webhook. */
  webhook_secret: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface PreorderOrder {
  id: string;
  org_id: string;
  event_id: string;
  /** Form submission id, or a hash for CSV rows. Null on staff-entered orders. */
  external_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  /** YYYY-MM-DD */
  requested_date: string;
  /** Sadhyas ordered — one per cover. */
  quantity: number;
  fulfillment_type: OrderType;
  /** "HH:MM:SS". Null = not yet placed. On takeaway this is the pickup time. */
  timeslot_start: string | null;
  /** Null on takeaway — a pickup consumes no seating window. */
  timeslot_end: string | null;
  address_street: string | null;
  address_apartment: string | null;
  address_city: string | null;
  address_zip: string | null;
  /** "Real Leaf" addon count. */
  addon_qty: number;
  special_requests: string | null;
  /** As submitted by the website form. Display-only — the form does not
   *  recalculate it when an order is later edited, so never derive from it. */
  order_total: number;
  status: PreorderStatus;
  /** Original payload, kept for audit. */
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
