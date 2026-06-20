"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Megaphone, Mail, MessageSquare, Store, Send, Trash2, Users, CheckCircle2 } from "lucide-react";
import {
  Card, SectionTitle, StatCard, Badge, Button, Modal, Input, Select, Field, EmptyState, PageSkeleton,
} from "@/components/ui";
import { useCustomers, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { listCampaigns, createCampaign, sendCampaign, deleteCampaign, matchSegment, type SegmentSpec } from "@/lib/api/marketing";
import { toast } from "@/lib/toast";
import type { Campaign, CampaignChannel, Customer } from "@/lib/api/database.types";

const channelIcon: Record<CampaignChannel, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  in_store: Store,
};

function NewCampaignForm({ customers, onDone }: { customers: Customer[]; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<CampaignChannel>("email");
  const [tier, setTier] = useState("");
  const [minVisits, setMinVisits] = useState("");
  const [inactiveDays, setInactiveDays] = useState("");

  const segment: SegmentSpec = {
    ...(tier ? { tier } : {}),
    ...(+minVisits > 0 ? { min_visits: +minVisits } : {}),
    ...(+inactiveDays > 0 ? { inactive_days: +inactiveDays } : {}),
  };
  const audience = matchSegment(customers, segment);

  const create = useMutation({
    mutationFn: () => createCampaign(org!.id, { name: name.trim(), channel, segment }),
    onSuccess: () => {
      invalidate("campaigns");
      toast.success("Campaign drafted", `${audience.length} customers in audience`);
      onDone();
    },
    onError: (e) => toast.error("Could not create campaign", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Campaign name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Win-back: 20% off" autoFocus />
      </Field>
      <Field label="Channel">
        <Select value={channel} onChange={(e) => setChannel(e.target.value as CampaignChannel)}>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="in_store">In-store</option>
        </Select>
      </Field>
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">Audience segment</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Tier">
            <Select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">Any</option>
              {["Platinum", "Gold", "Silver", "Bronze"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Min visits">
            <Input type="number" min="0" value={minVisits} onChange={(e) => setMinVisits(e.target.value)} placeholder="any" />
          </Field>
          <Field label="Inactive (days)">
            <Input type="number" min="0" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} placeholder="any" />
          </Field>
        </div>
      </div>
      <div className="rounded-xl border border-accent-400/20 bg-accent-400/5 p-3 text-sm text-accent-400">
        Live preview: <span className="font-bold">{audience.length}</span> customer{audience.length === 1 ? "" : "s"} match this segment
        {audience.length > 0 && (
          <span className="text-xs text-zinc-400"> — {audience.slice(0, 3).map((c) => c.name).join(", ")}{audience.length > 3 ? "..." : ""}</span>
        )}
      </div>
      <Button className="w-full" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
        Save as Draft
      </Button>
    </div>
  );
}

export default function Marketing() {
  const { org } = useOrg();
  const customersQ = useCustomers();
  const invalidate = useInvalidate();
  const [addingCampaign, setAddingCampaign] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["org", org?.id, "campaigns"],
    queryFn: () => listCampaigns(org!.id),
    enabled: !!org,
  });

  const customers = customersQ.data ?? [];
  const campaigns = campaignsQ.data ?? [];
  const sentCount = campaigns.filter((c) => c.status === "sent").length;

  const send = async (c: Campaign) => {
    const audience = matchSegment(customers, c.segment);
    try {
      await sendCampaign(org!.id, c, audience.length);
      invalidate("campaigns");
      toast.success(`"${c.name}" sent`, `Delivered to ${audience.length} customer${audience.length === 1 ? "" : "s"} (simulated)`);
    } catch (e) {
      toast.error("Send failed", e instanceof Error ? e.message : "");
    }
  };

  const segmentLabel = (s: SegmentSpec) => {
    const parts: string[] = [];
    if (s.tier) parts.push(`${s.tier} tier`);
    if (s.min_visits) parts.push(`${s.min_visits}+ visits`);
    if (s.inactive_days) parts.push(`inactive ${s.inactive_days}d+`);
    return parts.length ? parts.join(" · ") : "All customers";
  };

  if (campaignsQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Marketing"
        subtitle="Build a segment, then send a targeted campaign by email, SMS or in-store."
        action={
          <Button onClick={() => setAddingCampaign(true)}>
            <Megaphone className="h-4 w-4" /> New Campaign
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Campaigns" value={String(campaigns.length)} hint="all time" icon={Megaphone} />
        <StatCard title="Sent" value={String(sentCount)} hint="delivered" icon={CheckCircle2} />
        <StatCard title="Reachable" value={String(customers.length)} hint="customers in your book" icon={Users} />
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="No campaigns yet"
            hint="Build a segment (tier, visits, inactivity) and send a targeted promotion."
            action={
              <Button onClick={() => setAddingCampaign(true)}>
                <Megaphone className="h-4 w-4" /> New Campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const Icon = channelIcon[c.channel];
            const audience = matchSegment(customers, c.segment).length;
            return (
              <Card key={c.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="rounded-xl bg-gradient-to-br from-violet-soft/20 to-accent-400/10 p-2.5">
                    <Icon className="h-5 w-5 text-violet-soft" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={c.status === "sent" ? "green" : c.status === "scheduled" ? "amber" : "neutral"} className="capitalize">
                      {c.status}
                    </Badge>
                    <button
                      onClick={async () => {
                        await deleteCampaign(org!.id, c.id);
                        invalidate("campaigns");
                      }}
                      className="cursor-pointer rounded p-1 text-zinc-600 hover:text-rose-soft"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <h4 className="mt-3 font-semibold text-white">{c.name}</h4>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {segmentLabel(c.segment)} · {audience} customer{audience === 1 ? "" : "s"}
                </p>
                {c.status === "sent" ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                    {(
                      [
                        ["Sent", c.stats.sent ?? 0],
                        ["Opened", c.stats.opened ?? 0],
                        ["Redeemed", c.stats.redeemed ?? 0],
                      ] as const
                    ).map(([label, v]) => (
                      <div key={label}>
                        <p className="font-display text-lg font-bold text-brand-300">{v}</p>
                        <p className="text-[10px] tracking-wide text-zinc-500 uppercase">{label}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Button className="mt-3 w-full py-2 text-xs" onClick={() => send(c)} disabled={audience === 0}>
                    <Send className="h-3.5 w-3.5" /> Send Now {audience === 0 && "(empty audience)"}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={addingCampaign} onClose={() => setAddingCampaign(false)} title="New Campaign" wide>
        <NewCampaignForm customers={customers} onDone={() => setAddingCampaign(false)} />
      </Modal>
    </div>
  );
}
