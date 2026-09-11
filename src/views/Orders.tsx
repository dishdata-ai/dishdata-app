"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, ListOrdered, ChevronDown, Ban, Undo2, Download } from "lucide-react";
import { Card, SectionTitle, Badge, Button, Input, Select, EmptyState, PageSkeleton } from "@/components/ui";
import { computeTaxGroups } from "@/lib/tax";
import { ReceiptButton, PrintReceiptButton } from "@/components/ReceiptButton";
import { useOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { setOrderStatus } from "@/lib/api/orders";
import { toast } from "@/lib/toast";
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

/** Non-POS origins get a badge so platform orders are obvious in the history. */
const SOURCE_LABEL: Record<string, string> = {
  storefront: "Online",
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
  sumup: "SumUp",
};

const STATUS_TONE: Record<OrderStatus, "green" | "amber" | "rose" | "neutral"> = {
  paid: "green",
  open: "amber",
  void: "rose",
  refunded: "neutral",
};

/** One CSV field, quoted only when it needs to be (has a comma/quote/newline). */
function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CSV_COLUMNS = [
  "order_number", "created_at", "order_type", "status", "source", "guest_name",
  "items", "subtotal", "tax", "discount", "tip", "total",
] as const;

/**
 * Orders can mix VAT rates (food 7% / drinks 19%), so a single `tax` column
 * isn't enough for the bookkeeper — they need each rate's net and VAT split
 * out. Which rates appear varies by export, so the columns are built from the
 * rates actually present, and every row carries all of them (0 where unused)
 * to keep the sheet rectangular.
 */
function ordersToCSV(orders: Order[], orgRate: number): string {
  const breakdowns = orders.map((o) => computeTaxGroups(o.items, orgRate, o.discount || 0));
  const rates = [...new Set(breakdowns.flat().map((g) => g.rate))].sort((a, b) => a - b);
  const rateColumns = rates.flatMap((r) => [`net_${r}pct`, `vat_${r}pct`]);

  const header = [...CSV_COLUMNS, ...rateColumns].join(",");
  const rows = orders.map((o, i) => {
    const byRate = new Map(breakdowns[i].map((g) => [g.rate, g]));
    const base = CSV_COLUMNS.map((col) => {
      if (col === "items") return csvField(o.items.map((l) => `${l.qty}x ${l.name}`).join("; "));
      if (col === "guest_name") return csvField(o.guest_name ?? "");
      return csvField(o[col] as string | number);
    });
    const split = rates.flatMap((r) => {
      const g = byRate.get(r);
      return [csvField(g?.net ?? 0), csvField(g?.tax ?? 0)];
    });
    return [...base, ...split].join(",");
  });
  return [header, ...rows].join("\n");
}

const RANGE_TABS = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
] as const;

type RangeId = (typeof RANGE_TABS)[number]["id"];

/** Inclusive local-date bounds for a preset, as `YYYY-MM-DD` strings. */
function presetRange(id: RangeId): { from: string; to: string } {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const back = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return iso(d);
  };
  if (id === "today") return { from: iso(today), to: iso(today) };
  if (id === "7d") return { from: back(6), to: iso(today) };
  if (id === "30d") return { from: back(29), to: iso(today) };
  return { from: "", to: "" };
}

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
  const { org, isManager } = useOrg();
  const invalidate = useInvalidate();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [range, setRange] = useState<RangeId>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState<"all" | OrderType>("all");
  const [source, setSource] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const orders = ordersQ.data ?? [];

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: OrderStatus }) =>
      setOrderStatus(org!.id, id, next),
    onSuccess: (_r, { next }) => {
      invalidate("orders", "payments", "customers");
      toast.success(next === "void" ? "Order voided" : "Order refunded");
    },
    onError: (e) => toast.error("Could not update order", e instanceof Error ? e.message : ""),
  });

  /** Every distinct origin actually present, so the filter never offers an empty option. */
  const sources = useMemo(
    () => [...new Set(orders.map((o) => o.source))].sort(),
    [orders],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (type !== "all" && o.order_type !== type) return false;
      if (source !== "all" && o.source !== source) return false;
      // `created_at` is an ISO timestamp; its first 10 chars are the UTC date,
      // which is what the date inputs produce, so a string compare is enough.
      const day = o.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!q) return true;
      return (
        o.order_number.toLowerCase().includes(q) ||
        (o.guest_name ?? "").toLowerCase().includes(q) ||
        o.items.some((l) => l.name.toLowerCase().includes(q))
      );
    });
  }, [orders, status, type, source, from, to, query]);

  const pickRange = (id: RangeId) => {
    setRange(id);
    if (id === "custom") return; // keep whatever dates are already typed
    const r = presetRange(id);
    setFrom(r.from);
    setTo(r.to);
  };

  // Headline figures for the current filter — the point of filtering is usually
  // to ask "how much did X take", so answer it without a trip to Sales.
  const stats = useMemo(() => {
    const paid = filtered.filter((o) => o.status === "paid");
    const takings = paid.reduce((s, o) => s + o.total, 0);
    return {
      takings,
      paidCount: paid.length,
      avg: paid.length ? takings / paid.length : 0,
      vat: paid.reduce((s, o) => s + o.tax, 0),
    };
  }, [filtered]);

  const exportName = `orders-${from || "start"}_${to || "today"}`;

  if (ordersQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Orders"
        subtitle="Every order, newest first. Search, filter, and re-send a receipt."
        action={
          // Export is a manager action: it pulls guest names and full takings
          // out of the app in one click.
          isManager ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  downloadFile(JSON.stringify(filtered, null, 2), `${exportName}.json`, "application/json")
                }
                title={`Export ${filtered.length} filtered order${filtered.length === 1 ? "" : "s"} as JSON`}
              >
                <Download className="h-4 w-4" /> JSON
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  downloadFile(ordersToCSV(filtered, org?.tax_rate ?? 0), `${exportName}.csv`, "text/csv")
                }
                title={`Export ${filtered.length} filtered order${filtered.length === 1 ? "" : "s"} as CSV, with VAT split per rate`}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
            </div>
          ) : undefined
        }
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

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => pickRange(t.id)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              range === t.id
                ? "border border-brand-400/40 bg-brand-500/15 text-brand-200"
                : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
            )}
          >
            {t.label}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-auto py-1 text-xs"
              aria-label="From date"
            />
            <span className="text-xs text-zinc-500">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-auto py-1 text-xs"
              aria-label="To date"
            />
          </div>
        )}

        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />

        <Select
          value={type}
          onChange={(e) => setType(e.target.value as "all" | OrderType)}
          className="h-8 w-auto py-1 text-xs"
          aria-label="Order type"
        >
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABEL) as OrderType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>

        {sources.length > 1 && (
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-8 w-auto py-1 text-xs"
            aria-label="Order source"
          >
            <option value="all">All channels</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s] ?? "POS"}
              </option>
            ))}
          </Select>
        )}

        {(range !== "all" || type !== "all" || source !== "all" || status !== "all" || query) && (
          <button
            onClick={() => {
              pickRange("all");
              setType("all");
              setSource("all");
              setStatus("all");
              setQuery("");
            }}
            className="cursor-pointer text-xs font-semibold text-zinc-500 underline-offset-2 hover:text-white hover:underline"
          >
            Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Paid takings", value: fmt(stats.takings, 2), tone: true },
          { label: "Paid orders", value: String(stats.paidCount) },
          { label: "Average order", value: fmt(stats.avg, 2) },
          { label: "VAT collected", value: fmt(stats.vat, 2) },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className={cn("mt-0.5 text-lg font-bold", s.tone ? "text-brand-300" : "text-white")}>{s.value}</p>
          </Card>
        ))}
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
            <p className="text-sm font-semibold text-brand-300">{fmt(stats.takings, 2)}</p>
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
                canManage={isManager}
                onChangeStatus={(next) => changeStatus.mutate({ id: o.id, next })}
                busy={changeStatus.isPending}
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
  canManage,
  onChangeStatus,
  busy,
}: {
  order: Order;
  fmt: (n: number, d?: number) => string;
  open: boolean;
  onToggle: () => void;
  canManage: boolean;
  onChangeStatus: (next: OrderStatus) => void;
  busy: boolean;
}) {
  const itemSummary = order.items.map((l) => `${l.qty}× ${l.name}`).join(", ");
  // Void = cancel a mis-ring (open or paid). Refund = return money on a paid order.
  const canVoid = order.status === "open" || order.status === "paid";
  const canRefund = order.status === "paid";

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
              {SOURCE_LABEL[order.source] && (
                <Badge tone="violet" className="ml-2">{SOURCE_LABEL[order.source]}</Badge>
              )}
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
          {order.status === "paid" && (
            <>
              <PrintReceiptButton order={order} className="px-2.5 py-1.5 text-xs" label="Druck" />
              <ReceiptButton order={order} />
            </>
          )}
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

          {canManage && (canVoid || canRefund) && (
            <div className="mt-3 flex gap-2 border-t border-line pt-3">
              {canRefund && (
                <Button
                  variant="ghost"
                  className="px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Refund ${order.order_number}? The money is returned to the guest. The order stays in history as refunded.`))
                      onChangeStatus("refunded");
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Refund
                </Button>
              )}
              {canVoid && (
                <Button
                  variant="danger"
                  className="px-3 py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Void ${order.order_number}? Use this for a mis-ring/cancellation. It stays in history but won't count as a sale.`))
                      onChangeStatus("void");
                  }}
                >
                  <Ban className="h-3.5 w-3.5" /> Void
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
