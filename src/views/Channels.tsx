"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Bike, Check, X, Link2, Copy, AlertTriangle, Settings2, Inbox, Unlink,
} from "lucide-react";
import {
  Card, SectionTitle, Button, Badge, Modal, Input, Field, EmptyState, PageSkeleton,
} from "@/components/ui";
import { useChannels, useChannelOrders, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import {
  connectChannel, updateChannel, disconnectChannel,
  acceptChannelOrder, rejectChannelOrder, ackChannelOrder, webhookUrl,
} from "@/lib/api/channels";
import { PROVIDERS, PROVIDER_LABEL, PROVIDER_STORE_LABEL } from "@/lib/channels/providers";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { ChannelProvider, ChannelSafe, ChannelOrder } from "@/lib/api/database.types";

const PROVIDER_TONE: Record<ChannelProvider, string> = {
  wolt: "#00c2e8",
  ubereats: "#06c167",
  lieferando: "#ff8000",
};

/**
 * Uber falls back to manual handling if a POS order is not accepted within
 * ~11.5 minutes, so the inbox shows how long is left. Other platforms have no
 * published hard window — they get no countdown rather than a made-up one.
 */
const ACCEPT_WINDOW_MIN: Partial<Record<ChannelProvider, number>> = { ubereats: 11.5 };

function minutesLeft(co: ChannelOrder): number | null {
  const window = ACCEPT_WINDOW_MIN[co.provider];
  if (!window) return null;
  const elapsed = (Date.now() - new Date(co.received_at).getTime()) / 60000;
  return window - elapsed;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// One inbound order awaiting a decision.
// ---------------------------------------------------------------------------
function InboxCard({
  co, onAccept, onReject, pending,
}: {
  co: ChannelOrder;
  onAccept: () => void;
  onReject: () => void;
  pending: boolean;
}) {
  const fmt = useFmt();
  const unmapped = co.items.filter((l) => !l.recipe_id).length;
  const left = minutesLeft(co);

  return (
    <Card className="animate-rise p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PROVIDER_TONE[co.provider] }}
            />
            <p className="font-display text-sm font-bold text-white">
              {PROVIDER_LABEL[co.provider]} · #{co.external_display_id || co.external_id.slice(-6)}
            </p>
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 capitalize">
            {co.order_type.replace("_", "-")}
            {co.customer_name ? ` · ${co.customer_name}` : ""} · {timeAgo(co.received_at)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-gradient text-sm font-bold">{fmt(co.gross, 2)}</span>
          {left !== null && (
            <p
              className={cn(
                "text-[11px] font-semibold",
                left <= 3 ? "text-rose-soft" : "text-zinc-500",
              )}
            >
              {left > 0 ? `${Math.ceil(left)}m to accept` : "window passed"}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {co.items.map((l, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10 text-[11px] font-bold text-white">
              {l.qty}
            </span>
            <div className="min-w-0">
              <span className="text-zinc-200">{l.name}</span>
              {!l.recipe_id && (
                <Badge tone="amber" className="ml-1.5">unmapped</Badge>
              )}
              {l.notes && <p className="text-[11px] text-zinc-500">{l.notes}</p>}
            </div>
          </div>
        ))}
      </div>

      {co.notes && (
        <p className="mt-3 rounded-lg bg-amber-soft/10 p-2 text-xs text-amber-soft">{co.notes}</p>
      )}

      {unmapped > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-soft" />
          {unmapped} item{unmapped > 1 ? "s" : ""} did not match a recipe — they will ring up at the
          platform price but will not deplete stock. Rename the recipe to match to fix it.
        </p>
      )}

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <Button onClick={onAccept} disabled={pending}>
          <Check className="h-4 w-4" /> Accept
        </Button>
        <Button variant="ghost" onClick={onReject} disabled={pending}>
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-channel settings.
// ---------------------------------------------------------------------------
function SettingsModal({
  channel, onClose,
}: { channel: ChannelSafe | null; onClose: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState(() => channel);

  const save = useMutation({
    mutationFn: () =>
      updateChannel(org!.id, channel!.id, {
        auto_accept: form!.auto_accept,
        prep_minutes: form!.prep_minutes,
        commission_pct: form!.commission_pct,
        price_markup_pct: form!.price_markup_pct,
        send_to_kitchen: form!.send_to_kitchen,
        external_store_id: form!.external_store_id,
      }),
    onSuccess: () => {
      invalidate("channels");
      toast.success("Channel updated");
      onClose();
    },
    onError: (e) => toast.error("Could not save", e instanceof Error ? e.message : ""),
  });

  if (!channel || !form) return null;
  const set = <K extends keyof ChannelSafe>(k: K, v: ChannelSafe[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const toggles: { key: "auto_accept" | "send_to_kitchen"; label: string; hint: string }[] = [
    {
      key: "auto_accept",
      label: "Auto-accept orders",
      hint: "Skip the inbox and fire straight to the kitchen. Off means staff tap Accept first.",
    },
    {
      key: "send_to_kitchen",
      label: "Send to kitchen board",
      hint: "Off marks the ticket served immediately — for pre-packed handover only.",
    },
  ];

  return (
    <Modal open={!!channel} onClose={onClose} title={`${PROVIDER_LABEL[channel.provider]} settings`} wide>
      <div className="space-y-4">
        <Field label={PROVIDER_STORE_LABEL[channel.provider]}>
          <Input
            value={form.external_store_id}
            onChange={(e) => set("external_store_id", e.target.value)}
          />
        </Field>

        <div className="space-y-2">
          {toggles.map((t) => (
            <button
              key={t.key}
              onClick={() => set(t.key, !form[t.key])}
              className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[0.02] p-3 text-left hover:border-zinc-500"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-all",
                  form[t.key] ? "bg-brand-400/80" : "bg-white/10",
                )}
              >
                <span
                  className={cn(
                    "h-4 w-4 rounded-full bg-white transition-all",
                    form[t.key] && "translate-x-4",
                  )}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{t.label}</span>
                <span className="block text-xs text-zinc-500">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Prep time (min)">
            <Input
              type="number" min="0"
              value={form.prep_minutes}
              onChange={(e) => set("prep_minutes", +e.target.value || 0)}
            />
          </Field>
          <Field label="Commission %">
            <Input
              type="number" min="0" step="0.5"
              value={form.commission_pct}
              onChange={(e) => set("commission_pct", +e.target.value || 0)}
            />
          </Field>
          <Field label="Menu markup %">
            <Input
              type="number" min="0" step="0.5"
              value={form.price_markup_pct}
              onChange={(e) => set("price_markup_pct", +e.target.value || 0)}
            />
          </Field>
        </div>
        <p className="text-[11px] text-zinc-500">
          Commission is informational — used to show true margin on platform orders. Markup applies
          only when pushing your menu out to the platform; inbound totals are always what the guest
          actually paid.
        </p>

        <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
export default function Channels() {
  const { org, isAdmin } = useOrg();
  const fmt = useFmt();
  const channelsQ = useChannels();
  const ordersQ = useChannelOrders();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("channel_orders", ["channel_orders"]);

  const [connecting, setConnecting] = useState<ChannelProvider | null>(null);
  const [storeId, setStoreId] = useState("");
  const [settingsFor, setSettingsFor] = useState<ChannelSafe | null>(null);

  const channels = channelsQ.data ?? [];
  const byProvider = useMemo(
    () => new Map(channels.map((c) => [c.provider, c])),
    [channels],
  );
  const inbox = (ordersQ.data ?? []).filter((o) => o.status === "pending");
  const recent = (ordersQ.data ?? []).filter((o) => o.status !== "pending").slice(0, 12);

  const connect = useMutation({
    mutationFn: () =>
      connectChannel(org!.id, { provider: connecting!, externalStoreId: storeId.trim() }),
    onSuccess: () => {
      invalidate("channels");
      toast.success(`${PROVIDER_LABEL[connecting!]} connected`, "Give them the webhook URL below");
      setConnecting(null);
      setStoreId("");
    },
    onError: (e) => toast.error("Could not connect", e instanceof Error ? e.message : ""),
  });

  const decide = useMutation({
    mutationFn: async (v: { id: string; accept: boolean }) => {
      if (v.accept) await acceptChannelOrder(org!.id, v.id);
      else await rejectChannelOrder(org!.id, v.id, "Rejected by staff");
      // Our side is committed; the platform ack is best-effort and reports
      // back rather than throwing, so a platform outage cannot make a
      // successful accept look like a failure.
      return ackChannelOrder(v.id, v.accept ? "accept" : "deny", "Unable to fulfill");
    },
    onSuccess: (ackError, v) => {
      invalidate("channel_orders", "orders", "inventory", "inventory_tx", "payments", "deliveries");
      if (ackError) {
        toast.error(
          v.accept ? "Accepted here, but not on the platform" : "Rejected here only",
          `${ackError} Confirm on the platform tablet too.`,
        );
        return;
      }
      toast.success(v.accept ? "Order accepted" : "Order rejected",
        v.accept ? "Sent to kitchen · inventory updated" : undefined);
    },
    onError: (e) => toast.error("Could not update order", e instanceof Error ? e.message : ""),
  });

  const drop = useMutation({
    mutationFn: (id: string) => disconnectChannel(org!.id, id),
    onSuccess: () => {
      invalidate("channels");
      toast.success("Channel disconnected");
    },
    onError: (e) => toast.error("Could not disconnect", e instanceof Error ? e.message : ""),
  });

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast.success("Copied");
  };

  if (channelsQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Delivery Channels"
        subtitle="Wolt, Uber Eats and Lieferando orders in one inbox — accept once, straight to the kitchen."
      />

      {/* Inbox ------------------------------------------------------------ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Inbox className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-white">Incoming</h2>
          {inbox.length > 0 && (
            <span className="rounded-full bg-accent-400/20 px-2 text-[11px] font-bold text-accent-400">
              {inbox.length}
            </span>
          )}
        </div>
        {inbox.length === 0 ? (
          <Card>
            <EmptyState
              icon={Inbox}
              title="No orders waiting"
              hint={
                channels.length === 0
                  ? "Connect a channel below and its orders will land here."
                  : "New platform orders appear here the moment they arrive."
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {inbox.map((co) => (
              <InboxCard
                key={co.id}
                co={co}
                pending={decide.isPending}
                onAccept={() => decide.mutate({ id: co.id, accept: true })}
                onReject={() => decide.mutate({ id: co.id, accept: false })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Connections ------------------------------------------------------ */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Link2 className="h-4 w-4 text-zinc-400" />
          <h2 className="text-sm font-semibold text-white">Connections</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PROVIDERS.map((p) => {
            const ch = byProvider.get(p);
            return (
              <Card key={p} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: PROVIDER_TONE[p] }}
                    />
                    <h3 className="font-semibold text-white">{PROVIDER_LABEL[p]}</h3>
                  </div>
                  {ch ? (
                    <Badge tone={ch.is_active ? "green" : "amber"}>
                      {ch.is_active ? "Connected" : "Paused"}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Not connected</Badge>
                  )}
                </div>

                {ch ? (
                  <>
                    <p className="mt-2 text-xs text-zinc-500">
                      {PROVIDER_STORE_LABEL[p]}: <span className="text-zinc-300">{ch.external_store_id || "—"}</span>
                      <br />
                      {ch.last_order_at ? `Last order ${timeAgo(ch.last_order_at)}` : "No orders yet"}
                      {ch.auto_accept ? " · auto-accept on" : ""}
                    </p>

                    {ch.last_error && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-soft/10 p-2 text-[11px] text-rose-soft">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {ch.last_error}
                      </p>
                    )}

                    <div className="mt-3 space-y-1.5">
                      <p className="text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                        Webhook URL — give this to {PROVIDER_LABEL[p]}
                      </p>
                      <button
                        onClick={() => copy(webhookUrl(p, ch.external_store_id))}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-white/[0.02] p-2 text-left hover:border-zinc-500"
                      >
                        <code className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">
                          {webhookUrl(p, ch.external_store_id)}
                        </code>
                        <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      </button>
                      <button
                        onClick={() => copy(ch.webhook_secret)}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-white/[0.02] p-2 text-left hover:border-zinc-500"
                      >
                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                          Signing secret · tap to copy
                        </span>
                        <Copy className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      </button>
                    </div>

                    {isAdmin && (
                      <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
                        <Button variant="ghost" onClick={() => setSettingsFor(ch)}>
                          <Settings2 className="h-4 w-4" /> Settings
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => updateChannel(org!.id, ch.id, { is_active: !ch.is_active })
                            .then(() => invalidate("channels"))}
                          title={ch.is_active ? "Pause" : "Resume"}
                        >
                          {ch.is_active ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="danger" onClick={() => drop.mutate(ch.id)} title="Disconnect">
                          <Unlink className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-zinc-500">
                      Needs a partner agreement with {PROVIDER_LABEL[p]} — once approved, paste the{" "}
                      {PROVIDER_STORE_LABEL[p].toLowerCase()} they give you.
                    </p>
                    {isAdmin && (
                      <Button className="mt-3 w-full" onClick={() => setConnecting(p)}>
                        <Link2 className="h-4 w-4" /> Connect
                      </Button>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recently decided -------------------------------------------------- */}
      {recent.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-white">Recently handled</h2>
          <Card className="divide-y divide-line/60 p-0">
            {recent.map((co) => (
              <div key={co.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: PROVIDER_TONE[co.provider] }}
                  />
                  <span className="truncate text-zinc-300">
                    {PROVIDER_LABEL[co.provider]} · #{co.external_display_id || co.external_id.slice(-6)}
                    {co.customer_name ? ` · ${co.customer_name}` : ""}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-zinc-500">{fmt(co.gross, 2)}</span>
                  <Badge
                    tone={co.status === "accepted" ? "green" : co.status === "failed" ? "rose" : "neutral"}
                  >
                    {co.status}
                  </Badge>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Connect modal ----------------------------------------------------- */}
      <Modal
        open={!!connecting}
        onClose={() => setConnecting(null)}
        title={connecting ? `Connect ${PROVIDER_LABEL[connecting]}` : ""}
      >
        {connecting && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              Enter the {PROVIDER_STORE_LABEL[connecting].toLowerCase()} from your{" "}
              {PROVIDER_LABEL[connecting]} partner portal. We will generate a webhook URL and signing
              secret for you to register with them.
            </p>
            <Field label={PROVIDER_STORE_LABEL[connecting]}>
              <Input
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                placeholder="e.g. 6512f0a1b2c3d4e5f6a7b8c9"
                autoFocus
              />
            </Field>
            <Button
              className="w-full"
              onClick={() => connect.mutate()}
              disabled={!storeId.trim() || connect.isPending}
            >
              {connect.isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}
      </Modal>

      {/* Keyed so the form state is rebuilt for whichever channel is opened —
          the modal stays mounted, so a lazy useState initializer would keep
          the null it captured on first render. */}
      <SettingsModal
        key={settingsFor?.id ?? "none"}
        channel={settingsFor}
        onClose={() => setSettingsFor(null)}
      />
    </div>
  );
}
