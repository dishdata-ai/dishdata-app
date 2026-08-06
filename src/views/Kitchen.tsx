import { useEffect, useMemo, useState } from "react";
import { Flame, ChefHat, CheckCircle2, Bell, StickyNote } from "lucide-react";
import { Card, SectionTitle, Badge, Button, EmptyState, PageSkeleton } from "@/components/ui";
import { useOrders, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { setKitchenStatus } from "@/lib/api/orders";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Order, KitchenStatus } from "@/lib/api/database.types";

/** Where the ticket came from, when it was not rung up at the till. */
const SOURCE_LABEL: Record<string, string> = {
  storefront: "online",
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
};

const columns: { status: KitchenStatus; title: string; tone: string; next: KitchenStatus | null; action: string }[] = [
  { status: "new", title: "New", tone: "#22d3ee", next: "preparing", action: "Start" },
  { status: "preparing", title: "Preparing", tone: "#fbbf24", next: "ready", action: "Ready" },
  { status: "ready", title: "Ready to Serve", tone: "#34d399", next: "served", action: "Served" },
];

function ageMinutes(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

function Ticket({ order, now, onAdvance }: { order: Order; now: number; onAdvance: (s: KitchenStatus) => void }) {
  const col = columns.find((c) => c.status === order.kitchen_status)!;
  const age = ageMinutes(order.created_at, now);
  const urgent = age >= 15 && order.kitchen_status !== "ready";

  return (
    <Card
      className={cn("animate-rise p-4", urgent && "border-rose-soft/40 shadow-lg shadow-rose-soft/10")}
      key={order.id}
    >
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-bold text-white">{order.order_number}</p>
        <span
          className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", urgent ? "bg-rose-soft/15 text-rose-soft" : "bg-white/5 text-zinc-400")}
        >
          {age}m
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500 capitalize">
        {order.order_type.replace("_", "-")}
        {order.guest_name ? ` · ${order.guest_name}` : ""}
        {SOURCE_LABEL[order.source] ? ` · ${SOURCE_LABEL[order.source]}` : ""}
      </p>
      <div className="mt-3 space-y-1.5">
        {order.items.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-white/10 text-[11px] font-bold text-white">
              {l.qty}
            </span>
            <span className="text-zinc-200">{l.name}</span>
          </div>
        ))}
      </div>
      {order.kitchen_notes && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-soft/10 p-2 text-xs text-amber-soft">
          <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
          {order.kitchen_notes}
        </p>
      )}
      {col.next && (
        <Button
          className="mt-3 w-full py-2 text-sm"
          onClick={() => onAdvance(col.next!)}
        >
          {col.action}
        </Button>
      )}
    </Card>
  );
}

export default function Kitchen() {
  const { org } = useOrg();
  const ordersQ = useOrders();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("orders", ["orders"]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Sound cue when a new ticket arrives
  const [sound, setSound] = useState(true);
  const newCount = (ordersQ.data ?? []).filter((o) => o.kitchen_status === "new").length;
  const [prevNew, setPrevNew] = useState(newCount);
  useEffect(() => {
    if (newCount > prevNew && sound) {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        // audio not available — ignore
      }
    }
    setPrevNew(newCount);
  }, [newCount, prevNew, sound]);

  const active = useMemo(
    () =>
      (ordersQ.data ?? []).filter(
        (o) =>
          o.kitchen_status !== "served" &&
          o.status !== "void" &&
          Date.now() - new Date(o.created_at).getTime() < 12 * 3600000,
      ),
    [ordersQ.data],
  );

  const servedToday = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return (ordersQ.data ?? []).filter(
      (o) => o.kitchen_status === "served" && o.created_at.slice(0, 10) === todayKey,
    ).length;
  }, [ordersQ.data]);

  const advance = async (order: Order, status: KitchenStatus) => {
    try {
      await setKitchenStatus(org!.id, order.id, status);
      invalidate("orders");
      if (status === "ready") toast.success(`${order.order_number} ready`, "Service notified");
    } catch (e) {
      toast.error("Could not update ticket", e instanceof Error ? e.message : "");
    }
  };

  if (ordersQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Kitchen"
        subtitle="Live ticket board — orders stream in from POS and online ordering."
        action={
          <div className="flex items-center gap-3">
            <Badge tone="green">
              <CheckCircle2 className="h-3 w-3" /> {servedToday} served today
            </Badge>
            <button
              onClick={() => setSound((s) => !s)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                sound ? "border-brand-400/30 bg-brand-400/10 text-brand-300" : "border-line text-zinc-500",
              )}
            >
              <Bell className="h-3 w-3" /> {sound ? "Sound on" : "Sound off"}
            </button>
          </div>
        }
      />

      {active.length === 0 ? (
        <Card>
          <EmptyState
            icon={Flame}
            title="The line is clear"
            hint="New POS and online orders appear here instantly, ordered by age."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((col) => {
            const tickets = active
              .filter((o) => o.kitchen_status === col.status)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            return (
              <div key={col.status} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.tone }} />
                  <h3 className="font-semibold text-white">{col.title}</h3>
                  <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs font-bold text-zinc-400">
                    {tickets.length}
                  </span>
                </div>
                {tickets.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line p-6 text-center text-xs text-zinc-600">
                    <ChefHat className="mx-auto mb-1.5 h-4 w-4" />
                    Empty
                  </div>
                ) : (
                  tickets.map((o) => <Ticket key={o.id} order={o} now={now} onAdvance={(s) => advance(o, s)} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
