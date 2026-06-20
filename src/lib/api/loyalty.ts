// Loyalty engine API — admin config CRUD, customer point ops, and public storefront
// wrappers. Each function branches on isSupabaseConfigured (demo mode mirrors the schema).

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  LoyaltyProgram,
  LoyaltyTier,
  LoyaltyEarnRule,
  LoyaltyReward,
  LoyaltyRedemption,
  LoyaltyTransaction,
  LoyaltyActionType,
  LoyaltyTierPerks,
  Customer,
  Org,
} from "@/lib/api/database.types";

const dPrograms = demoTable<LoyaltyProgram & { id: string }>("loyalty_programs");
const dTiers = demoTable<LoyaltyTier>("loyalty_tiers");
const dRules = demoTable<LoyaltyEarnRule>("loyalty_earn_rules");
const dRewards = demoTable<LoyaltyReward>("loyalty_rewards");
const dRedemptions = demoTable<LoyaltyRedemption>("loyalty_redemptions");
const dTx = demoTable<LoyaltyTransaction>("loyalty_transactions");
const dCustomers = demoTable<Customer>("customers");

// ---- Demo defaults (mirror seed_default_loyalty in 0002_loyalty.sql) ----------
function seedDemoLoyalty(orgId: string) {
  if (dPrograms.get(orgId)) return;
  const now = new Date().toISOString();
  dPrograms.insert({
    id: orgId, org_id: orgId, enabled: true, points_name: "points", earn_rate: 1,
    redeem_rate: 0.1, tier_basis: "lifetime", rolling_window_days: 365,
    points_expiry_days: null, settings: {},
  } as LoyaltyProgram & { id: string });
  const tier = (name: string, threshold: number, sort: number, color: string, perks: object) =>
    dTiers.insert({ id: uid(), org_id: orgId, name, threshold, sort_order: sort, color, icon: null, perks, created_at: now } as LoyaltyTier);
  tier("Bronze", 0, 0, "#cd7f32", { earn_multiplier: 1, birthday_bonus: 50 });
  tier("Silver", 500, 1, "#c0c0c0", { earn_multiplier: 1.25, birthday_bonus: 100 });
  tier("Gold", 2000, 2, "#ffd700", { earn_multiplier: 1.5, birthday_bonus: 200, free_delivery: true });
  tier("Platinum", 5000, 3, "#e5e4e2", { earn_multiplier: 2, birthday_bonus: 500, free_delivery: true });
  const rule = (action_type: LoyaltyActionType, label: string, description: string, points: number, verification: LoyaltyEarnRule["verification"], repeatable: boolean) =>
    dRules.insert({ id: uid(), org_id: orgId, action_type, label, description, points, enabled: true, verification, repeatable, cooldown_days: null, config: {}, created_at: now } as LoyaltyEarnRule);
  rule("purchase", "Make a purchase", "Earn points on every order", 0, "auto", true);
  rule("signup", "Create an account", "Welcome bonus for joining", 100, "auto", false);
  rule("birthday", "Birthday treat", "Bonus points every birthday", 200, "auto", false);
  rule("newsletter", "Subscribe to the newsletter", "One-time bonus for opting in", 75, "honor", false);
  rule("instagram_follow", "Follow on Instagram", "One-time bonus for following", 50, "honor", false);
  rule("review", "Leave a review", "Thank-you points for feedback", 40, "honor", true);
  const reward = (reward_type: LoyaltyReward["reward_type"], label: string, description: string, cost_points: number, value: number, sort: number) =>
    dRewards.insert({ id: uid(), org_id: orgId, reward_type, label, description, cost_points, value, free_recipe_id: null, min_tier_id: null, enabled: true, image_url: null, sort_order: sort, created_at: now } as LoyaltyReward);
  reward("amount_discount", "€5 off", "Take €5 off your next order", 500, 5, 0);
  reward("percent_discount", "10% off", "10% off your whole order", 800, 10, 1);
  reward("free_delivery", "Free delivery", "We cover delivery on your next order", 300, 0, 2);
}

// ---- Program -----------------------------------------------------------------
export async function getProgram(orgId: string): Promise<LoyaltyProgram> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    seedDemoLoyalty(orgId);
    return dPrograms.get(orgId) as LoyaltyProgram;
  }
  const sb = getSupabase();
  const { data } = await sb.from("loyalty_programs").select("*").eq("org_id", orgId).maybeSingle();
  if (data) return data as LoyaltyProgram;
  const { data: created, error } = await sb
    .from("loyalty_programs").insert({ org_id: orgId }).select().single();
  if (error) throw error;
  return created as LoyaltyProgram;
}

export async function updateProgram(orgId: string, patch: Partial<LoyaltyProgram>): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPrograms.update(orgId, patch);
    return;
  }
  const { error } = await getSupabase().from("loyalty_programs").update(patch).eq("org_id", orgId);
  if (error) throw error;
}

// ---- Tiers -------------------------------------------------------------------
export async function listTiers(orgId: string): Promise<LoyaltyTier[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTiers.list({ org_id: orgId } as Partial<LoyaltyTier>).sort((a, b) => a.sort_order - b.sort_order);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_tiers").select("*").eq("org_id", orgId).order("sort_order");
  if (error) throw error;
  return (data ?? []) as LoyaltyTier[];
}

export async function upsertTier(orgId: string, tier: Partial<LoyaltyTier> & { id?: string }): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    if (tier.id) dTiers.update(tier.id, tier);
    else dTiers.insert({ id: uid(), org_id: orgId, name: "", threshold: 0, sort_order: 0, color: null, icon: null, perks: {}, created_at: new Date().toISOString(), ...tier } as LoyaltyTier);
    return;
  }
  const sb = getSupabase();
  if (tier.id) {
    const { id, ...patch } = tier;
    const { error } = await sb.from("loyalty_tiers").update(patch).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("loyalty_tiers").insert({ org_id: orgId, ...tier });
    if (error) throw error;
  }
}

export async function deleteTier(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) { await demoDelay(); dTiers.remove(id); return; }
  const { error } = await getSupabase().from("loyalty_tiers").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

// ---- Earn rules --------------------------------------------------------------
export async function listEarnRules(orgId: string): Promise<LoyaltyEarnRule[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dRules.list({ org_id: orgId } as Partial<LoyaltyEarnRule>);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_earn_rules").select("*").eq("org_id", orgId).order("created_at");
  if (error) throw error;
  return (data ?? []) as LoyaltyEarnRule[];
}

export async function updateEarnRule(orgId: string, id: string, patch: Partial<LoyaltyEarnRule>): Promise<void> {
  if (!isSupabaseConfigured) { await demoDelay(); dRules.update(id, patch); return; }
  const { error } = await getSupabase().from("loyalty_earn_rules").update(patch).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

// ---- Rewards -----------------------------------------------------------------
export async function listRewards(orgId: string): Promise<LoyaltyReward[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dRewards.list({ org_id: orgId } as Partial<LoyaltyReward>).sort((a, b) => a.sort_order - b.sort_order);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_rewards").select("*").eq("org_id", orgId).order("sort_order");
  if (error) throw error;
  return (data ?? []) as LoyaltyReward[];
}

export async function upsertReward(orgId: string, reward: Partial<LoyaltyReward> & { id?: string }): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    if (reward.id) dRewards.update(reward.id, reward);
    else dRewards.insert({ id: uid(), org_id: orgId, reward_type: "amount_discount", label: "", description: null, cost_points: 0, value: 0, free_recipe_id: null, min_tier_id: null, enabled: true, image_url: null, sort_order: 0, created_at: new Date().toISOString(), ...reward } as LoyaltyReward);
    return;
  }
  const sb = getSupabase();
  if (reward.id) {
    const { id, ...patch } = reward;
    const { error } = await sb.from("loyalty_rewards").update(patch).eq("id", id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("loyalty_rewards").insert({ org_id: orgId, ...reward });
    if (error) throw error;
  }
}

export async function deleteReward(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) { await demoDelay(); dRewards.remove(id); return; }
  const { error } = await getSupabase().from("loyalty_rewards").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

// ---- Customer ops ------------------------------------------------------------
export interface AwardResult { awarded: number; status: string }

export async function awardPoints(orgId: string, customerId: string, action: LoyaltyActionType): Promise<AwardResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const rule = dRules.list({ org_id: orgId } as Partial<LoyaltyEarnRule>).find((r) => r.action_type === action && r.enabled);
    if (!rule) return { awarded: 0, status: "no_rule" };
    const cust = dCustomers.get(customerId);
    if (!cust) return { awarded: 0, status: "no_customer" };
    const pts = rule.points;
    dCustomers.update(customerId, { points: cust.points + pts, status_points: (cust.status_points ?? 0) + pts });
    dTx.insert({ id: uid(), org_id: orgId, customer_id: customerId, points_delta: pts, reason: rule.label, order_id: null, action_type: action, created_at: new Date().toISOString() } as LoyaltyTransaction);
    return { awarded: pts, status: "ok" };
  }
  const { data, error } = await getSupabase().rpc("loyalty_award", { _org: orgId, _customer: customerId, _action: action });
  if (error) throw error;
  return data as AwardResult;
}

export interface RedeemResult { code: string; reward: string; reward_type: string; value: number; cost_points: number }

export async function redeemReward(orgId: string, customerId: string, rewardId: string): Promise<RedeemResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const reward = dRewards.get(rewardId);
    const cust = dCustomers.get(customerId);
    if (!reward || !cust) throw new Error("reward unavailable");
    if (cust.points < reward.cost_points) throw new Error("not enough points");
    const code = uid().toUpperCase().slice(0, 10);
    dCustomers.update(customerId, { points: cust.points - reward.cost_points });
    dRedemptions.insert({ id: uid(), org_id: orgId, customer_id: customerId, reward_id: rewardId, reward_snapshot: reward as unknown as Record<string, unknown>, points_spent: reward.cost_points, code, status: "issued", expires_at: null, applied_order_id: null, created_at: new Date().toISOString() } as LoyaltyRedemption);
    dTx.insert({ id: uid(), org_id: orgId, customer_id: customerId, points_delta: -reward.cost_points, reason: `Redeemed: ${reward.label}`, order_id: null, action_type: null, created_at: new Date().toISOString() } as LoyaltyTransaction);
    return { code, reward: reward.label, reward_type: reward.reward_type, value: reward.value, cost_points: reward.cost_points };
  }
  const { data, error } = await getSupabase().rpc("loyalty_redeem", { _org: orgId, _customer: customerId, _reward: rewardId });
  if (error) throw error;
  return data as RedeemResult;
}

export async function listRedemptions(orgId: string): Promise<LoyaltyRedemption[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dRedemptions.list({ org_id: orgId } as Partial<LoyaltyRedemption>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const { data, error } = await getSupabase()
    .from("loyalty_redemptions").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as LoyaltyRedemption[];
}

export async function listLoyaltyTransactions(orgId: string, customerId?: string): Promise<LoyaltyTransaction[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dTx.list({ org_id: orgId, ...(customerId ? { customer_id: customerId } : {}) } as Partial<LoyaltyTransaction>)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  let q = getSupabase().from("loyalty_transactions").select("*").eq("org_id", orgId);
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as LoyaltyTransaction[];
}

export async function confirmVerification(claimId: string): Promise<AwardResult> {
  if (!isSupabaseConfigured) { await demoDelay(); return { awarded: 0, status: "ok" }; }
  const { data, error } = await getSupabase().rpc("loyalty_confirm_verification", { _claim_id: claimId });
  if (error) throw error;
  return data as AwardResult;
}

// ---- Public storefront (anon) ------------------------------------------------
export interface LoyaltySummary {
  enabled: boolean;
  points_name?: string;
  tier_basis?: string;
  customer?: {
    id: string; name: string; points: number; status_points: number;
    tier: string; newsletter_opt_in: boolean;
  } | null;
  next_tier?: { name: string; threshold: number } | null;
  tiers: { name: string; threshold: number; color: string | null; perks: LoyaltyTierPerks }[];
  earn_rules: { action_type: LoyaltyActionType; label: string; description: string | null; points: number; verification: string }[];
  rewards: { id: string; reward_type: string; label: string; description: string | null; cost_points: number; value: number }[];
}

const dOrgs = demoTable<Org>("orgs");

export async function publicLoyaltySummary(slug: string, email?: string): Promise<LoyaltySummary> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("restaurant not found");
    seedDemoLoyalty(org.id);
    const prog = dPrograms.get(org.id);
    const empty: LoyaltySummary = { enabled: false, tiers: [], earn_rules: [], rewards: [] };
    if (!prog || !prog.enabled) return empty;
    const cust = email
      ? dCustomers.list({ org_id: org.id } as Partial<Customer>).find((c) => c.email?.toLowerCase() === email.toLowerCase())
      : undefined;
    const tiers = dTiers.list({ org_id: org.id } as Partial<LoyaltyTier>).sort((a, b) => a.sort_order - b.sort_order);
    const sp = cust?.status_points ?? 0;
    const next = tiers.find((t) => t.threshold > sp);
    return {
      enabled: true, points_name: prog.points_name, tier_basis: prog.tier_basis,
      customer: cust ? { id: cust.id, name: cust.name, points: cust.points, status_points: sp, tier: cust.tier, newsletter_opt_in: cust.newsletter_opt_in ?? false } : null,
      next_tier: next ? { name: next.name, threshold: next.threshold } : null,
      tiers: tiers.map((t) => ({ name: t.name, threshold: t.threshold, color: t.color, perks: t.perks })),
      earn_rules: dRules.list({ org_id: org.id } as Partial<LoyaltyEarnRule>).filter((r) => r.enabled).map((r) => ({ action_type: r.action_type, label: r.label, description: r.description, points: r.points, verification: r.verification })),
      rewards: dRewards.list({ org_id: org.id } as Partial<LoyaltyReward>).filter((r) => r.enabled).sort((a, b) => a.sort_order - b.sort_order).map((r) => ({ id: r.id, reward_type: r.reward_type, label: r.label, description: r.description, cost_points: r.cost_points, value: r.value })),
    };
  }
  const { data, error } = await getSupabase().rpc("loyalty_public_summary", { _slug: slug, _email: email ?? null });
  if (error) throw error;
  return data as LoyaltySummary;
}

export async function publicLoyaltyClaim(slug: string, email: string, name: string, action: LoyaltyActionType): Promise<AwardResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("restaurant not found");
    seedDemoLoyalty(org.id);
    let cust = dCustomers.list({ org_id: org.id } as Partial<Customer>).find((c) => c.email?.toLowerCase() === email.toLowerCase());
    if (!cust) {
      cust = dCustomers.insert({ id: uid(), org_id: org.id, name: name || "Guest", email: email.toLowerCase(), phone: null, visits: 0, total_spend: 0, points: 0, tier: "Bronze", last_visit_at: null, birthday: null, status_points: 0, tier_id: null, newsletter_opt_in: false, instagram_handle: null } as Customer);
    }
    if (action === "newsletter") dCustomers.update(cust.id, { newsletter_opt_in: true });
    return awardPoints(org.id, cust.id, action);
  }
  const { data, error } = await getSupabase().rpc("loyalty_public_claim", { _slug: slug, _email: email, _name: name, _action: action });
  if (error) throw error;
  return data as AwardResult;
}

export async function publicLoyaltyRedeem(slug: string, email: string, rewardId: string): Promise<RedeemResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = dOrgs.list().find((o) => o.slug === slug);
    if (!org) throw new Error("restaurant not found");
    const cust = dCustomers.list({ org_id: org.id } as Partial<Customer>).find((c) => c.email?.toLowerCase() === email.toLowerCase());
    if (!cust) throw new Error("no loyalty account for this email");
    return redeemReward(org.id, cust.id, rewardId);
  }
  const { data, error } = await getSupabase().rpc("loyalty_public_redeem", { _slug: slug, _email: email, _reward: rewardId });
  if (error) throw error;
  return data as RedeemResult;
}
