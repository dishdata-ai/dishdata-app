"use client";

import { useState } from "react";
import { Gift, Award, Sparkles } from "lucide-react";
import { Card, Button, Badge, Input, ProgressBar } from "@/components/ui";
import { publicLoyaltyClaim, publicLoyaltyRedeem, type LoyaltySummary } from "@/lib/api/loyalty";
import type { LoyaltyActionType } from "@/lib/api/database.types";
import { errorMessage, fmtNumber } from "@/lib/utils";
import { toast } from "@/lib/toast";

/**
 * The rewards lookup-and-redeem UI, shared by the storefront's Rewards page
 * and (previously) its modal. Kept as one component so both stay in sync.
 */
export function LoyaltyPanel({
  slug, summary, loading, email, setEmail, activeEmail, onLookup, onChanged, onRedeemed,
}: {
  slug: string;
  summary: LoyaltySummary | undefined;
  loading: boolean;
  email: string;
  setEmail: (v: string) => void;
  activeEmail: string | null;
  onLookup: () => void;
  onChanged: () => void;
  onRedeemed: (code: string, reward: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!summary && loading) return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  if (summary && !summary.enabled) return <p className="py-8 text-center text-sm text-zinc-500">This restaurant hasn't set up rewards yet.</p>;

  const cust = summary?.customer ?? null;
  const next = summary?.next_tier ?? null;
  const pointsName = summary?.points_name ?? "points";
  const progress = next && next.threshold > 0 ? Math.min(100, ((cust?.status_points ?? 0) / next.threshold) * 100) : 100;

  const claim = async (action: LoyaltyActionType) => {
    if (!activeEmail) { toast.error("Enter your email first", ""); return; }
    setBusy(action);
    try {
      const res = await publicLoyaltyClaim(slug, activeEmail, cust?.name ?? "", action);
      if (res.status === "ok") toast.success(`+${res.awarded} ${pointsName}!`, "");
      else if (res.status === "already_claimed") toast.error("Already claimed", "You've earned this one before");
      else if (res.status === "pending_verification") toast.success("Submitted", "Points land once verified");
      else toast.error("Nothing to claim", "");
      onChanged();
    } catch (e) { toast.error("Could not claim", errorMessage(e)); }
    finally { setBusy(null); }
  };

  const redeem = async (id: string, label: string) => {
    if (!activeEmail) { toast.error("Enter your email first", ""); return; }
    setBusy(id);
    try {
      const res = await publicLoyaltyRedeem(slug, activeEmail, id);
      toast.success("Reward unlocked!", `Code ${res.code} — applied at checkout`);
      onRedeemed(res.code, label);
    } catch (e) { toast.error("Could not redeem", errorMessage(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      {/* Email lookup */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLookup()}
        />
        <Button onClick={onLookup} disabled={loading}>{loading ? "…" : "View my rewards"}</Button>
      </div>

      {/* Balance + tier */}
      {cust && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">Hi {cust.name}, you have</p>
              <p className="font-display text-3xl font-bold text-white">{fmtNumber(cust.points)} <span className="text-base text-brand-300">{pointsName}</span></p>
            </div>
            <Badge tone="amber"><Award className="h-3.5 w-3.5" /> {cust.tier}</Badge>
          </div>
          {next && (
            <div>
              <ProgressBar value={progress} tone="cyan" />
              <p className="mt-1.5 text-xs text-zinc-500">{Math.max(0, next.threshold - (cust.status_points ?? 0))} {pointsName} to {next.name}</p>
            </div>
          )}
        </Card>
      )}

      {/* Ways to earn */}
      {summary && summary.earn_rules.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4 text-brand-300" /> Ways to earn</p>
          <div className="space-y-2">
            {summary.earn_rules.map((r) => (
              <div key={r.action_type} className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{r.label}</p>
                  {r.description && <p className="truncate text-xs text-zinc-500">{r.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.points > 0 && <Badge tone="green">+{r.points}</Badge>}
                  {r.action_type === "purchase" ? (
                    <span className="text-xs text-zinc-500">automatic</span>
                  ) : ["newsletter", "instagram_follow", "review", "referral"].includes(r.action_type) ? (
                    <Button variant="ghost" onClick={() => claim(r.action_type)} disabled={busy === r.action_type || !activeEmail}>
                      {busy === r.action_type ? "…" : "Claim"}
                    </Button>
                  ) : (
                    <span className="text-xs text-zinc-500">automatic</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rewards */}
      {summary && summary.rewards.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Gift className="h-4 w-4 text-brand-300" /> Redeem your {pointsName}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.rewards.map((r) => {
              const canAfford = (cust?.points ?? 0) >= r.cost_points;
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{r.label}</p>
                    <p className="text-xs text-brand-300">{fmtNumber(r.cost_points)} {pointsName}</p>
                  </div>
                  <Button variant={canAfford ? "primary" : "ghost"} onClick={() => redeem(r.id, r.label)} disabled={busy === r.id || !activeEmail || !canAfford}>
                    {busy === r.id ? "…" : "Redeem"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!activeEmail && (
        <p className="text-center text-xs text-zinc-500">Enter your email to see your balance, claim points and redeem rewards.</p>
      )}
    </div>
  );
}
