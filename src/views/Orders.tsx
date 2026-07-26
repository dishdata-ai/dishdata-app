"use client";

import { useMemo, useState } from "react";
import { Search, ListOrdered, ChevronDown } from "lucide-react";
import { Card, SectionTitle, Badge, Input, EmptyState, PageSkeleton } from "@/components/ui";
import { ReceiptButton } from "@/components/ReceiptButton";
import { useOrders } from "@/lib/hooks/data";
import { useFmt } from "@/lib/hooks/useFmt";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus, OrderType } from "@/lib/api/database.types";

const STATUS_TABS: { id: "all" | OrderStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "paid", label: "Paid" },
  { id: "open", label: "Open" },
  { id: "void", label: "Void" },
  { id: "refunded", label: "Refunded" },
];

const TYPE_LABEL: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

const STATUS_TONE: Record<OrderStatus, "green" | "amber" | "rose" | "neutral"> = {
  paid: "green",
  open: "amber",
  void: "rose",
  refunded: "neutral",
};

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toISOString().slice(0, 10);
  const day = iso.slice(0, 10);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (day === today) return `Today, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}, ${time}`;
}

export default function Orders() {
  const ordersQ = useOrders();
  const fmt = useFmt();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const orders = ordersQ.data ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        (o.guest_name ?? "").toLowerCase().includes(q) ||
        o.items.some((l) => l.name.toLowerCase().includes(q))
      );
    });
  }, [orders, status, query]);

  const totalTakings = useMemo(
    () => filtered.filter((o) => o.status === "paid").reduce((s, o) => s + o.total, 0),
    [filtered],
  );

  if (ordersQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Orders"
        subtitle="Every order, newest first. Search, filter, and re-send a receipt."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search order no., guest, or item…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              className={cn(
                "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                status === t.id
                  ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                  : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">
              {filtered.length} {filtered.length === 1 ? "order" : "orders"}
            </h3>
            <p className="text-xs text-zinc-500">
              {orders.length >= 500 ? "Most recent 500" : "All orders"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-brand-300">{fmt(totalTakings, 2)}</p>
            <p className="text-xs text-zinc-500">paid takings (filtered)</p>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ListOrdered}
            title="No orders match"
            hint={query ? "Try a different search." : "Ring something up in the POS."}
          />
        ) : (
          <div className="divide-y divide-line/60">
            {filtered.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                fmt={fmt}
                open={expanded === o.id}
                onToggle={() => setExpanded(expanded === o.id ? null : o.id)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OrderRow({
  order,
  fmt,
  open,
  onToggle,
}: {
  order: Order;
  fmt: (n: number, d?: number) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const itemSummary = order.items.map((l) => `${l.qty}× ${l.name}`).join(", ");

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onToggle} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left">
          <ChevronDown
            className={cn("mt-0.5 h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              {order.order_number}
              <span className="ml-2 text-xs text-zinc-500">{TYPE_LABEL[order.order_type]}</span>
              {order.guest_name && <span className="ml-2 text-xs text-zinc-500">· {order.guest_name}</span>}
            </p>
            <p className="truncate text-xs text-zinc-500">
              {when(order.created_at)} · {itemSummary}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-semibold text-brand-300">{fmt(order.total, 2)}</p>
            <Badge tone={STATUS_TONE[order.status]} className="mt-0.5 capitalize">
              {order.status}
            </Badge>
          </div>
          {order.status === "paid" && <ReceiptButton order={order} />}
        </div>
      </div>

      {open && (
        <div className="mt-3 ml-6 rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
          {order.items.map((l, i) => (
            <div key={i} className="flex justify-between py-0.5 text-zinc-300">
              <span>
                {l.qty}× {l.name}
              </span>
              <span>{fmt(l.price * l.qty, 2)}</span>
            </div>
          ))}
          <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Net</span>
              <span>{fmt(order.subtotal, 2)}</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Incl. tax</span>
              <span>{fmt(order.tax, 2)}</span>
            </div>
            {order.tip > 0 && (
              <div className="flex justify-between text-zinc-400">
                <span>Tip</span>
                <span>{fmt(order.tip, 2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-sm font-semibold text-white">
              <span>Total</span>
              <span>{fmt(order.total, 2)}</span>
            </div>
          </div>
          {order.kitchen_notes && (
            <p className="mt-2 text-xs text-zinc-500">Note: {order.kitchen_notes}</p>
          )}
        </div>
      )}
    </div>
  );
}
