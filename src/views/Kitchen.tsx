import { useEffect, useMemo, useState } from "react";
import { Flame, ChefHat, CheckCircle2, Bell, StickyNote, Check, PackageCheck } from "lucide-react";
import { Card, SectionTitle, Badge, Button, EmptyState, PageSkeleton } from "@/components/ui";
import { useOrders, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { setKitchenStatus, setLineReady } from "@/lib/api/orders";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Order, KitchenStatus } from "@/lib/api/database.types";

/** Where the ticket came from, when it was not rung up at the till. */
const SOURCE_LABEL: Record<string, string> = {
  storefront: "online",
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
  sumup: "SumUp",
};

const columns: { status: KitchenStatus; title: string; tone: string; next: KitchenStatus | null; action: string }[] = [
  { status: "new", title: "New", tone: "#22d3ee", next: "preparing", action: "Start" },
  { status: "preparing", title: "Preparing", tone: "#fbbf24", next: "ready", action: "Ready" },
  { status: "ready", title: "Ready to Serve", tone: "#34d399", next: "served", action: "Served" },
];

function ageMinutes(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

function Ticket({
  order,
  now,
  highlighted,
  onAdvance,
  onToggleLine,
}: {
  order: Order;
  now: number;
  highlighted: boolean;
  onAdvance: (s: KitchenStatus) => void;
  onToggleLine: (index: number, ready: boolean) => void;
}) {
  const col = columns.find((c) => c.status === order.kitchen_status)!;
  const age = ageMinutes(order.created_at, now);
  const urgent = age >= 15 && order.kitchen_status !== "ready";
  const readyCount = order.items.filter((l) => l.ready).length;
  const partly = readyCount > 0 && readyCount < order.items.length;

  return (
    <div id={`ticket-${order.id}`}>
    <Card
      className={cn(
        "animate-rise p-4 transition-shadow",
        urgent && "border-rose-soft/40 shadow-lg shadow-rose-soft/10",
        partly && "border-brand-400/40",
        highlighted && "ring-2 ring-accent-400",
      )}
      key={order.id}
    >
      <div className="flex items-center justify-between">
        <p className="font-display text-sm font-bold text-white">
          {order.order_number}
          {partly && (
            <span className="ml-2 rounded-full bg-brand-400/15 px-2 py-0.5 text-[10px] font-bold text-brand-300">
              {readyCount}/{order.items.length} ready
            </span>
          )}
        </p>
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
          <button
            key={i}
            onClick={() => onToggleLine(i, !l.ready)}
            aria-label={l.ready ? `Undo ${l.name} ready` : `Mark ${l.name} ready`}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm transition-colors",
              l.ready ? "bg-brand-400/10" : "hover:bg-white/[0.05]",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold",
                l.ready ? "bg-brand-400 text-zinc-950" : "bg-white/10 text-white",
              )}
            >
              {l.ready ? <Check className="h-3 w-3" strokeWidth={3} /> : l.qty}
            </span>
            <span className={cn(l.ready ? "text-brand-300" : "text-zinc-200")}>
              {l.ready && l.qty > 1 ? `${l.qty}× ` : ""}
              {l.name}
            </span>
            {l.ready && <span className="ml-auto text-[10px] font-semibold text-brand-300 uppercase">ready</span>}
          </button>
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
    </div>
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

  const toggleLine = async (order: Order, index: number, ready: boolean) => {
    try {
      const status = await setLineReady(org!.id, order, index, ready);
      invalidate("orders");
      if (status === "ready" && order.kitchen_status !== "ready") toast.success(`${order.order_number} ready`, "Service notified");
    } catch (e) {
      toast.error("Could not update item", e instanceof Error ? e.message : "");
    }
  };

  const [flashId, setFlashId] = useState<string | null>(null);
  const jumpTo = (id: string) => {
    document.getElementById(`ticket-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 2500);
  };

  // Tickets with something ready to carry out, so nobody has to hunt through the board.
  const pickups = useMemo(
    () =>
      active
        .filter((o) => o.items.some((l) => l.ready))
        .map((o) => ({ order: o, lines: o.items.filter((l) => l.ready), complete: o.items.every((l) => l.ready) }))
        .sort((a, b) => a.order.created_at.localeCompare(b.order.created_at)),
    [active],
  );

  // What still has to be cooked across every waiting ticket, biggest first (batch cooking).
  const toMake = useMemo(() => {
    const totals = new Map<string, { qty: number; orders: Set<string> }>();
    for (const o of active) {
      if (o.kitchen_status === "ready") continue;
      for (const l of o.items) {
        if (l.ready) continue;
        const t = totals.get(l.name) ?? { qty: 0, orders: new Set<string>() };
        t.qty += l.qty;
        t.orders.add(o.order_number);
        totals.set(l.name, t);
      }
    }
    return [...totals.entries()].map(([name, t]) => ({ name, qty: t.qty, orders: t.orders.size })).sort((a, b) => b.qty - a.qty);
  }, [active]);

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

      {pickups.length > 0 && (
        <Card className="border-brand-400/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <PackageCheck className="h-4 w-4 text-brand-300" /> Ready to pick up
          </div>
          <div className="flex flex-wrap gap-2">
            {pickups.map(({ order, lines, complete }) => (
              <button
                key={order.id}
                onClick={() => jumpTo(order.id)}
                className="cursor-pointer rounded-xl border border-brand-400/30 bg-brand-400/10 px-3 py-2 text-left transition-colors hover:bg-brand-400/20"
              >
                <p className="text-xs font-bold text-white">
                  {order.order_number}
                  {order.guest_name ? ` · ${order.guest_name}` : ""}
                  {!complete && <span className="ml-1.5 font-normal text-zinc-400">(more coming)</span>}
                </p>
                <p className="text-xs text-brand-300">{lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</p>
              </button>
            ))}
          </div>
        </Card>
      )}

      {toMake.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Still to make</span>
          {toMake.map((m) => (
            <span key={m.name} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-zinc-200">
              <span className="font-bold text-white">{m.qty}×</span> {m.name}
              {m.orders > 1 && <span className="text-zinc-500"> · {m.orders} orders</span>}
            </span>
          ))}
        </div>
      )}

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
                  tickets.map((o) => (
                    <Ticket
                      key={o.id}
                      order={o}
                      now={now}
                      highlighted={flashId === o.id}
                      onAdvance={(s) => advance(o, s)}
                      onToggleLine={(i, ready) => toggleLine(o, i, ready)}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
