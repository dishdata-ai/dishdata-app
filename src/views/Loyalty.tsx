"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gift, Award, Sparkles, Ticket, Plus, Trash2, Pencil, Settings2, Star, ShoppingBag,
  Cake, Instagram, Mail, Users, MessageSquare, BadgeCheck,
} from "lucide-react";
import {
  Card, SectionTitle, StatCard, Badge, Button, Modal, Input, Select, Field, Table,
  EmptyState, PageSkeleton,
} from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { useRecipes } from "@/lib/hooks/data";
import { toast } from "@/lib/toast";
import { cn, errorMessage, fmtNumber } from "@/lib/utils";
import {
  getProgram, updateProgram, listTiers, upsertTier, deleteTier,
  listEarnRules, updateEarnRule, listRewards, upsertReward, deleteReward, listRedemptions,
} from "@/lib/api/loyalty";
import type {
  LoyaltyProgram, LoyaltyTier, LoyaltyEarnRule, LoyaltyReward, LoyaltyActionType,
  LoyaltyRewardType, LoyaltyVerification,
} from "@/lib/api/database.types";

type Tab = "program" | "tiers" | "earn" | "rewards" | "activity";

const TABS: { id: Tab; label: string; icon: typeof Gift }[] = [
  { id: "program", label: "Program", icon: Settings2 },
  { id: "tiers", label: "Tiers", icon: Award },
  { id: "earn", label: "Ways to Earn", icon: Sparkles },
  { id: "rewards", label: "Rewards", icon: Gift },
  { id: "activity", label: "Activity", icon: Ticket },
];

const ACTION_ICON: Record<string, typeof Gift> = {
  purchase: ShoppingBag, signup: Users, birthday: Cake, instagram_follow: Instagram,
  newsletter: Mail, review: MessageSquare, referral: Users, visit: Star, custom: Sparkles,
};

const REWARD_TYPES: { value: LoyaltyRewardType; label: string }[] = [
  { value: "amount_discount", label: "Amount off" },
  { value: "percent_discount", label: "Percent off" },
  { value: "free_item", label: "Free item" },
  { value: "free_delivery", label: "Free delivery" },
  { value: "custom", label: "Custom" },
];

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
        on ? "bg-brand-500" : "bg-white/10",
      )}
      aria-pressed={on}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export default function Loyalty() {
  const { org } = useOrg();
  const fmt = useFmt();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("program");

  const orgId = org?.id;
  const programQ = useQuery({ queryKey: ["org", orgId, "loyalty", "program"], queryFn: () => getProgram(orgId!), enabled: !!orgId });
  const tiersQ = useQuery({ queryKey: ["org", orgId, "loyalty", "tiers"], queryFn: () => listTiers(orgId!), enabled: !!orgId });
  const rulesQ = useQuery({ queryKey: ["org", orgId, "loyalty", "earn"], queryFn: () => listEarnRules(orgId!), enabled: !!orgId });
  const rewardsQ = useQuery({ queryKey: ["org", orgId, "loyalty", "rewards"], queryFn: () => listRewards(orgId!), enabled: !!orgId });
  const redemptionsQ = useQuery({ queryKey: ["org", orgId, "loyalty", "redemptions"], queryFn: () => listRedemptions(orgId!), enabled: !!orgId });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org", orgId, "loyalty"] });

  if (!org || programQ.isLoading) return <PageSkeleton />;
  const program = programQ.data!;
  const tiers = tiersQ.data ?? [];
  const rules = rulesQ.data ?? [];
  const rewards = rewardsQ.data ?? [];
  const redemptions = redemptionsQ.data ?? [];

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Loyalty"
        subtitle="Design your own rewards program — tiers, ways to earn, and redeemable rewards. Fully customizable."
        action={<Badge tone={program.enabled ? "green" : "neutral"}>{program.enabled ? "Live" : "Off"}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Points name" value={program.points_name} icon={Sparkles} hint={`${program.earn_rate} per ${fmt(1)}`} />
        <StatCard title="Tiers" value={String(tiers.length)} icon={Award} hint={program.tier_basis.replace("_", " ")} />
        <StatCard title="Rewards" value={String(rewards.length)} icon={Gift} hint="redeemable" />
        <StatCard title="Redemptions" value={fmtNumber(redemptions.length)} icon={Ticket} hint="all time" />
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-white/[0.02] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
              tab === t.id ? "bg-gradient-to-r from-brand-500/15 to-accent-400/5 text-brand-300 ring-1 ring-brand-400/20" : "text-zinc-400 hover:text-white",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "program" && <ProgramTab program={program} orgId={org.id} onSaved={invalidate} />}
      {tab === "tiers" && <TiersTab tiers={tiers} orgId={org.id} basis={program.tier_basis} fmt={fmt} onChanged={invalidate} />}
      {tab === "earn" && <EarnTab rules={rules} orgId={org.id} pointsName={program.points_name} onChanged={invalidate} />}
      {tab === "rewards" && <RewardsTab rewards={rewards} tiers={tiers} orgId={org.id} pointsName={program.points_name} onChanged={invalidate} />}
      {tab === "activity" && <ActivityTab redemptions={redemptions} />}
    </div>
  );
}

// ---- Program tab -------------------------------------------------------------
function ProgramTab({ program, orgId, onSaved }: { program: LoyaltyProgram; orgId: string; onSaved: () => void }) {
  const [form, setForm] = useState(program);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LoyaltyProgram>(k: K, v: LoyaltyProgram[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await updateProgram(orgId, {
        enabled: form.enabled, points_name: form.points_name, earn_rate: Number(form.earn_rate),
        redeem_rate: Number(form.redeem_rate), tier_basis: form.tier_basis,
        rolling_window_days: Number(form.rolling_window_days),
        points_expiry_days: form.points_expiry_days ? Number(form.points_expiry_days) : null,
      });
      onSaved();
      toast.success("Program saved", "Your loyalty settings are live");
    } catch (e) { toast.error("Could not save", errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">Program status</p>
          <p className="text-xs text-zinc-400">Turn the whole loyalty program on or off.</p>
        </div>
        <Toggle on={form.enabled} onClick={() => set("enabled", !form.enabled)} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Points name (what you call points)">
          <Input value={form.points_name} onChange={(e) => set("points_name", e.target.value)} placeholder="e.g. Stars, Coins" />
        </Field>
        <Field label="Tier basis (how customers climb)">
          <Select value={form.tier_basis} onChange={(e) => set("tier_basis", e.target.value as LoyaltyProgram["tier_basis"])}>
            <option value="lifetime">Lifetime points earned</option>
            <option value="rolling_12mo">Points in a rolling window</option>
            <option value="spend">Total money spent</option>
          </Select>
        </Field>
        <Field label="Earn rate (points per currency unit)">
          <Input type="number" step="0.1" value={form.earn_rate} onChange={(e) => set("earn_rate", Number(e.target.value))} />
        </Field>
        <Field label="Redeem value (currency per point)">
          <Input type="number" step="0.01" value={form.redeem_rate} onChange={(e) => set("redeem_rate", Number(e.target.value))} />
        </Field>
        {form.tier_basis === "rolling_12mo" && (
          <Field label="Rolling window (days)">
            <Input type="number" value={form.rolling_window_days} onChange={(e) => set("rolling_window_days", Number(e.target.value))} />
          </Field>
        )}
        <Field label="Points expiry (days, blank = never)">
          <Input type="number" value={form.points_expiry_days ?? ""} onChange={(e) => set("points_expiry_days", e.target.value ? Number(e.target.value) : null)} />
        </Field>
      </div>
      <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save program"}</Button>
    </Card>
  );
}

// ---- Tiers tab ---------------------------------------------------------------
function TiersTab({ tiers, orgId, basis, fmt, onChanged }: { tiers: LoyaltyTier[]; orgId: string; basis: string; fmt: (n: number) => string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Partial<LoyaltyTier> | null>(null);
  const metric = basis === "spend" ? "spend" : "points";

  const remove = async (id: string) => {
    try { await deleteTier(orgId, id); onChanged(); toast.success("Tier removed", ""); }
    catch (e) { toast.error("Could not delete", errorMessage(e)); }
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">Tiers</p>
          <p className="text-xs text-zinc-400">Higher tiers unlock multipliers and perks. Threshold is measured in {metric}.</p>
        </div>
        <Button variant="ghost" onClick={() => setEditing({ name: "", threshold: 0, sort_order: tiers.length, perks: {} })}><Plus className="h-4 w-4" /> Add tier</Button>
      </div>
      {tiers.length === 0 ? (
        <EmptyState icon={Award} title="No tiers yet" hint="Add your first tier to start ranking members." />
      ) : (
        <Table headers={["Tier", `Threshold (${metric})`, "Earn ×", "Birthday bonus", "Perks", ""]}>
          {tiers.map((t) => (
            <tr key={t.id} className="border-t border-line/50">
              <td className="py-3"><span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: t.color ?? "#888" }} /><span className="font-semibold text-white">{t.name}</span></span></td>
              <td className="text-zinc-300">{basis === "spend" ? fmt(t.threshold) : fmtNumber(t.threshold)}</td>
              <td className="text-zinc-300">{t.perks.earn_multiplier ?? 1}×</td>
              <td className="text-zinc-300">{t.perks.birthday_bonus ?? 0}</td>
              <td>{t.perks.free_delivery && <Badge tone="cyan">Free delivery</Badge>}</td>
              <td className="text-right">
                <button onClick={() => setEditing(t)} className="mr-1 cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(t.id)} className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-rose-soft/10 hover:text-rose-soft"><Trash2 className="h-4 w-4" /></button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <TierModal tier={editing} orgId={orgId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </Card>
  );
}

function TierModal({ tier, orgId, onClose, onSaved }: { tier: Partial<LoyaltyTier>; orgId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: tier.name ?? "", threshold: tier.threshold ?? 0, sort_order: tier.sort_order ?? 0,
    color: tier.color ?? "#34d399",
    earn_multiplier: tier.perks?.earn_multiplier ?? 1, birthday_bonus: tier.perks?.birthday_bonus ?? 0,
    free_delivery: tier.perks?.free_delivery ?? false,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await upsertTier(orgId, {
        id: tier.id, name: f.name.trim(), threshold: Number(f.threshold), sort_order: Number(f.sort_order),
        color: f.color, perks: { earn_multiplier: Number(f.earn_multiplier), birthday_bonus: Number(f.birthday_bonus), free_delivery: f.free_delivery },
      });
      onSaved(); toast.success(tier.id ? "Tier updated" : "Tier added", "");
    } catch (e) { toast.error("Could not save", errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={tier.id ? "Edit tier" : "New tier"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Threshold"><Input type="number" value={f.threshold} onChange={(e) => setF({ ...f, threshold: Number(e.target.value) })} /></Field>
          <Field label="Earn multiplier"><Input type="number" step="0.05" value={f.earn_multiplier} onChange={(e) => setF({ ...f, earn_multiplier: Number(e.target.value) })} /></Field>
          <Field label="Birthday bonus"><Input type="number" value={f.birthday_bonus} onChange={(e) => setF({ ...f, birthday_bonus: Number(e.target.value) })} /></Field>
          <Field label="Sort order"><Input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })} /></Field>
          <Field label="Color"><Input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-[42px] p-1" /></Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={f.free_delivery} onChange={(e) => setF({ ...f, free_delivery: e.target.checked })} /> Free delivery perk
        </label>
        <Button className="w-full" onClick={save} disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save tier"}</Button>
      </div>
    </Modal>
  );
}

// ---- Earn tab ----------------------------------------------------------------
function EarnTab({ rules, orgId, pointsName, onChanged }: { rules: LoyaltyEarnRule[]; orgId: string; pointsName: string; onChanged: () => void }) {
  return (
    <div className="space-y-3">
      {rules.length === 0 && <EmptyState icon={Sparkles} title="No earn rules" hint="Default rules are created with your program." />}
      {rules.map((r) => <EarnRow key={r.id} rule={r} orgId={orgId} pointsName={pointsName} onChanged={onChanged} />)}
    </div>
  );
}

function EarnRow({ rule, orgId, pointsName, onChanged }: { rule: LoyaltyEarnRule; orgId: string; pointsName: string; onChanged: () => void }) {
  const [points, setPoints] = useState(rule.points);
  const [verification, setVerification] = useState<LoyaltyVerification>(rule.verification);
  const [busy, setBusy] = useState(false);
  const Icon = ACTION_ICON[rule.action_type] ?? Sparkles;
  const dirty = points !== rule.points || verification !== rule.verification;

  const toggle = async () => {
    try { await updateEarnRule(orgId, rule.id, { enabled: !rule.enabled }); onChanged(); }
    catch (e) { toast.error("Could not update", errorMessage(e)); }
  };
  const save = async () => {
    setBusy(true);
    try { await updateEarnRule(orgId, rule.id, { points: Number(points), verification }); onChanged(); toast.success("Rule saved", ""); }
    catch (e) { toast.error("Could not save", errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <Card className={cn("flex flex-wrap items-center gap-4 p-4", !rule.enabled && "opacity-60")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="rounded-xl bg-white/[0.04] p-2.5"><Icon className="h-5 w-5 text-brand-300" /></div>
        <div className="min-w-0">
          <p className="font-semibold text-white">{rule.label}</p>
          <p className="truncate text-xs text-zinc-400">{rule.description}</p>
        </div>
      </div>
      {rule.action_type === "purchase" ? (
        <Badge tone="neutral">Uses earn rate</Badge>
      ) : (
        <div className="w-28">
          <Field label={pointsName}><Input type="number" value={points} onChange={(e) => setPoints(Number(e.target.value))} /></Field>
        </div>
      )}
      <div className="w-36">
        <Field label="Verification">
          <Select value={verification} onChange={(e) => setVerification(e.target.value as LoyaltyVerification)}>
            <option value="auto">Automatic</option>
            <option value="honor">Honor (self-claim)</option>
            <option value="verified">Verified</option>
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        {dirty && <Button onClick={save} disabled={busy}>{busy ? "…" : "Save"}</Button>}
        <Toggle on={rule.enabled} onClick={toggle} />
      </div>
    </Card>
  );
}

// ---- Rewards tab -------------------------------------------------------------
function RewardsTab({ rewards, tiers, orgId, pointsName, onChanged }: { rewards: LoyaltyReward[]; tiers: LoyaltyTier[]; orgId: string; pointsName: string; onChanged: () => void }) {
  const [editing, setEditing] = useState<Partial<LoyaltyReward> | null>(null);
  const remove = async (id: string) => {
    try { await deleteReward(orgId, id); onChanged(); toast.success("Reward removed", ""); }
    catch (e) { toast.error("Could not delete", errorMessage(e)); }
  };
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-semibold text-white">Rewards catalog</p>
          <p className="text-xs text-zinc-400">What customers can redeem their {pointsName} for.</p>
        </div>
        <Button variant="ghost" onClick={() => setEditing({ reward_type: "amount_discount", label: "", cost_points: 100, value: 0, enabled: true })}><Plus className="h-4 w-4" /> Add reward</Button>
      </div>
      {rewards.length === 0 ? (
        <EmptyState icon={Gift} title="No rewards yet" hint="Add a reward customers can redeem points for." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rewards.map((r) => (
            <div key={r.id} className={cn("flex items-center gap-3 rounded-xl border border-line p-4", !r.enabled && "opacity-60")}>
              <div className="rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-400/10 p-2.5"><Gift className="h-5 w-5 text-brand-300" /></div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{r.label}</p>
                <p className="truncate text-xs text-zinc-400">{r.description}</p>
              </div>
              <Badge tone="amber">{fmtNumber(r.cost_points)} {pointsName}</Badge>
              <button onClick={() => setEditing(r)} className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove(r.id)} className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-rose-soft/10 hover:text-rose-soft"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
      {editing && <RewardModal reward={editing} tiers={tiers} orgId={orgId} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </Card>
  );
}

function RewardModal({ reward, tiers, orgId, onClose, onSaved }: { reward: Partial<LoyaltyReward>; tiers: LoyaltyTier[]; orgId: string; onClose: () => void; onSaved: () => void }) {
  const recipesQ = useRecipes();
  const [f, setF] = useState({
    reward_type: (reward.reward_type ?? "amount_discount") as LoyaltyRewardType,
    label: reward.label ?? "", description: reward.description ?? "",
    cost_points: reward.cost_points ?? 100, value: reward.value ?? 0,
    free_recipe_id: reward.free_recipe_id ?? "", min_tier_id: reward.min_tier_id ?? "", enabled: reward.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const needsValue = f.reward_type === "amount_discount" || f.reward_type === "percent_discount";
  const save = async () => {
    setBusy(true);
    try {
      await upsertReward(orgId, {
        id: reward.id, reward_type: f.reward_type, label: f.label.trim(), description: f.description.trim() || null,
        cost_points: Number(f.cost_points), value: Number(f.value),
        free_recipe_id: f.reward_type === "free_item" ? (f.free_recipe_id || null) : null,
        min_tier_id: f.min_tier_id || null, enabled: f.enabled,
      });
      onSaved(); toast.success(reward.id ? "Reward updated" : "Reward added", "");
    } catch (e) { toast.error("Could not save", errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={reward.id ? "Edit reward" : "New reward"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reward type">
            <Select value={f.reward_type} onChange={(e) => setF({ ...f, reward_type: e.target.value as LoyaltyRewardType })}>
              {REWARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Cost (points)"><Input type="number" value={f.cost_points} onChange={(e) => setF({ ...f, cost_points: Number(e.target.value) })} /></Field>
          <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. €5 off" autoFocus /></Field>
          {needsValue && <Field label={f.reward_type === "percent_discount" ? "Percent (%)" : "Amount"}><Input type="number" step="0.5" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></Field>}
          {f.reward_type === "free_item" && (
            <Field label="Free item">
              <Select value={f.free_recipe_id} onChange={(e) => setF({ ...f, free_recipe_id: e.target.value })}>
                <option value="">Select an item…</option>
                {(recipesQ.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.emoji} {r.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Min tier (optional gate)">
            <Select value={f.min_tier_id} onChange={(e) => setF({ ...f, min_tier_id: e.target.value })}>
              <option value="">Any tier</option>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Enabled
        </label>
        <Button className="w-full" onClick={save} disabled={busy || !f.label.trim()}>{busy ? "Saving…" : "Save reward"}</Button>
      </div>
    </Modal>
  );
}

// ---- Activity tab ------------------------------------------------------------
function ActivityTab({ redemptions }: { redemptions: import("@/lib/api/database.types").LoyaltyRedemption[] }) {
  const tone: Record<string, "green" | "amber" | "rose" | "neutral"> = { issued: "amber", applied: "green", expired: "neutral", void: "rose" };
  return (
    <Card className="p-6">
      <p className="mb-4 font-semibold text-white">Recent redemptions</p>
      {redemptions.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="No redemptions yet" hint="Vouchers customers redeem will appear here." />
      ) : (
        <Table headers={["Code", "Reward", "Points", "Status", "When"]}>
          {redemptions.map((r) => (
            <tr key={r.id} className="border-t border-line/50">
              <td className="py-3 font-mono text-sm text-brand-300">{r.code}</td>
              <td className="text-zinc-200">{String((r.reward_snapshot as { label?: string })?.label ?? "—")}</td>
              <td className="text-zinc-300">{fmtNumber(r.points_spent)}</td>
              <td><Badge tone={tone[r.status] ?? "neutral"}>{r.status}</Badge></td>
              <td className="text-zinc-500">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
