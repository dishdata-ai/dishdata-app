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
  /** Optional separate logo for receipts/invoices — a transparent PNG prints cleaner on a thermal roll than a solid-background mark. Falls back to logo_url when unset. */
  receipt_logo_url: string | null;
  accent_color: string | null;
  currency: string;
  tax_rate: number;
  /** Ceiling on a staff ("friends & family") discount, in %. 0 disables the feature. */
  staff_discount_max_pct: number;
  /** € of staff discount one employee may give per calendar month. null = uncapped. */
  staff_discount_monthly_cap: number | null;
  /** € above which an approver's PIN is required at the till. null = never. */
  staff_discount_pin_threshold: number | null;
  target_food_cost_pct: number;
  onboarding_completed: boolean;
  settings: Record<string, unknown>;
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
  description: string | null;
  name_de: string | null;
  description_de: string | null;
  category_de: string | null;
  is_active: boolean;
  /** null = available. In the future = sold out until then (today's cutoff or a far-future "indefinitely" date). */
  sold_out_until: string | null;
  /** null = inherit the org's default tax_rate. Set explicitly for e.g. drinks (19%) on an org whose default is the reduced food rate. */
  tax_rate: number | null;
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
  /** VAT rate snapshotted at checkout — what applied then, not the recipe's current setting. Missing on pre-0032 orders (treat as the org's rate). */
  tax_rate?: number;
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
  discount: number;
  status: OrderStatus;
  kitchen_status: KitchenStatus;
  kitchen_notes: string | null;
  source: string;
  created_at: string;
  /** Who rang the order up. Null on storefront/platform orders and pre-0033 orders. */
  employee_id?: string | null;
  /** Whose staff allowance paid for the discount. Null = not a staff discount. */
  staff_discount_employee_id?: string | null;
  /** The staff-discount portion of `discount` — excludes any loyalty voucher on the same order. */
  staff_discount_amount?: number;

  // --- TSE (KassenSichV §146a AO), migration 0035 ---------------------------
  /** 'not_required' on pre-TSE orders and at restaurants with no TSE configured. */
  tse_status?: "signed" | "failed" | "not_required";
  tse_transaction_number?: number | null;
  tse_signature_counter?: number | null;
  tse_signature?: string | null;
  tse_serial_number?: string | null;
  tse_time_start?: string | null;
  tse_time_end?: string | null;
  tse_timestamp_format?: string | null;
  tse_signature_algorithm?: string | null;
  tse_public_key?: string | null;
  tse_client_serial?: string | null;
  /** Full QR payload from the TSE — printed instead of every field in plain text. */
  tse_qr_data?: string | null;
  /** Why a signature is missing, for the Verfahrensdokumentation. */
  tse_error?: string | null;
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
  /** May approve a staff discount above the org's PIN threshold, using their `pin`. */
  can_approve_discounts?: boolean;
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

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TaskLink {
  id: string;
  label: string;
  url: string;
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
  is_partner_task: boolean;
  assignee_user_id: string | null;
  /** Effort points (1/2/3/5/8) — contribution weight for the partner leaderboard. */
  effort: number;
  category: string | null;
  checklist: ChecklistItem[];
  links: TaskLink[];
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
}

export interface TaskComment {
  id: string;
  org_id: string;
  task_id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface PartnerProfile {
  id: string;
  org_id: string;
  user_id: string;
  skills: string[];
  focus: string | null;
  location: string | null;
  updated_at: string;
}

export interface Kudo {
  id: string;
  org_id: string;
  from_user: string;
  to_user: string;
  task_id: string | null;
  message: string;
  emoji: string;
  created_at: string;
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

export interface Receipt {
  id: string;
  org_id: string;
  order_id: string;
  receipt_number: string;
  customer_email: string | null;
  customer_name: string | null;
  status: 'generated' | 'emailed';
  emailed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface EventMenu {
  id: string;
  org_id: string;
  name: string;
  is_active: boolean;
  /** When true (and active), the public storefront shows this menu instead of the full catalog. */
  show_on_website: boolean;
  /** Food is pre-prepared: POS marks these orders served at checkout, skipping the kitchen board. */
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

// --- Delivery channels (Uber Eats / Wolt / Lieferando) — see migration 0026 ---

export type ChannelProvider = 'ubereats' | 'wolt' | 'lieferando';
export type ChannelOrderStatus = 'pending' | 'accepted' | 'rejected' | 'failed';

export interface Channel {
  id: string;
  org_id: string;
  provider: ChannelProvider;
  /** The platform's own id for this location (store / venue / restaurant id). */
  external_store_id: string;
  is_active: boolean;
  /**
   * Platform API credentials. RLS restricts the row to owner/admin and the
   * client API layer never selects this column — see ChannelSafe.
   */
  credentials: Record<string, unknown>;
  /** Our shared secret — the platform signs inbound webhooks with it. */
  webhook_secret: string;
  /** Skip the pending tray and fire straight to the kitchen. */
  auto_accept: boolean;
  /** Quoted prep time sent back to the platform on accept. */
  prep_minutes: number;
  /** Commission the platform takes, for margin reporting (informational). */
  commission_pct: number;
  /** Markup applied when pushing our menu OUT to the platform, never to inbound totals. */
  price_markup_pct: number;
  send_to_kitchen: boolean;
  settings: Record<string, unknown>;
  last_order_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/**
 * Channel rows as the client sees them: `credentials` is never selected, so the
 * UI works off a boolean instead of the secret material itself.
 */
export type ChannelSafe = Omit<Channel, 'credentials'> & { has_credentials: boolean };

/** A normalized inbound line. `recipe_id` is null when no recipe matched by name. */
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
  /** The platform's order id — idempotency key for their webhook retries. */
  external_id: string;
  /** Short human code the courier/guest quotes. */
  external_display_id: string;
  status: ChannelOrderStatus;
  order_id: string | null;
  items: ChannelOrderLine[];
  gross: number;
  customer_name: string;
  order_type: OrderType;
  notes: string | null;
  fulfillment: Record<string, unknown>;
  raw: Record<string, unknown>;
  reject_reason: string | null;
  received_at: string;
  decided_at: string | null;
  decided_by: string | null;
}
