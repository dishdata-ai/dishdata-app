import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { LoyaltyActionType, LoyaltyEarnRule, LoyaltyReward, LoyaltyTier } from "@/lib/types";

export async function listTiers(orgId: string): Promise<LoyaltyTier[]> {
  if (!isSupabaseConfigured) {
    return [...demo.loyaltyTiers].sort((a, b) => a.sort_order - b.sort_order);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_tiers")
    .select("*")
    .eq("org_id", orgId)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function listRewards(orgId: string): Promise<LoyaltyReward[]> {
  if (!isSupabaseConfigured) {
    return [...demo.loyaltyRewards].filter((r) => r.enabled).sort((a, b) => a.sort_order - b.sort_order);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_rewards")
    .select("*")
    .eq("org_id", orgId)
    .eq("enabled", true)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}

export async function listEarnRules(orgId: string): Promise<LoyaltyEarnRule[]> {
  if (!isSupabaseConfigured) {
    return [...demo.loyaltyEarnRules].filter((r) => r.enabled);
  }
  const { data, error } = await getSupabase()
    .from("loyalty_earn_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("enabled", true)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export interface AwardResult {
  awarded: number;
  status: string;
}

// Staff-initiated: award one of the org's configured earn actions to a
// customer at the till (e.g. a birthday treat or review bonus for a walk-in).
export async function awardPoints(orgId: string, customerId: string, action: LoyaltyActionType): Promise<AwardResult> {
  if (!isSupabaseConfigured) {
    const rule = demo.loyaltyEarnRules.find((r) => r.action_type === action && r.enabled);
    const cust = demo.customers.find((c) => c.id === customerId);
    if (!rule) return { awarded: 0, status: "no_rule" };
    if (!cust) return { awarded: 0, status: "no_customer" };
    cust.points += rule.points;
    cust.status_points = (cust.status_points ?? 0) + rule.points;
    return { awarded: rule.points, status: "ok" };
  }
  const { data, error } = await getSupabase().rpc("loyalty_award", {
    _org: orgId,
    _customer: customerId,
    _action: action,
  });
  if (error) throw error;
  return data as AwardResult;
}

export interface RedeemResult {
  code: string;
  reward: string;
  reward_type: string;
  value: number;
  cost_points: number;
}

// Redeem a reward on a customer's behalf, in person — hands back a voucher
// code staff can read out or key into the order's redemption code at checkout.
export async function redeemReward(orgId: string, customerId: string, rewardId: string): Promise<RedeemResult> {
  if (!isSupabaseConfigured) {
    const reward = demo.loyaltyRewards.find((r) => r.id === rewardId);
    const cust = demo.customers.find((c) => c.id === customerId);
    if (!reward || !cust) throw new Error("reward unavailable");
    if (cust.points < reward.cost_points) throw new Error("not enough points");
    cust.points -= reward.cost_points;
    const code = uid().toUpperCase().slice(0, 10);
    return { code, reward: reward.label, reward_type: reward.reward_type, value: reward.value, cost_points: reward.cost_points };
  }
  const { data, error } = await getSupabase().rpc("loyalty_redeem", {
    _org: orgId,
    _customer: customerId,
    _reward: rewardId,
  });
  if (error) throw error;
  return data as RedeemResult;
}
