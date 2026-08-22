"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CalendarClock, Users, UtensilsCrossed, ShoppingBag, Euro, AlertTriangle,
  Plus, Upload, Settings2, Check, X, Undo2, Search, Link2, MapPin, MessageSquare,
  Download, Phone, Mail, Eye, Globe, FileSpreadsheet, UserRound,
} from "lucide-react";
import {
  Card, SectionTitle, Badge, Button, Input, Textarea, Select, Field, Modal,
  EmptyState, PageSkeleton, ProgressBar, Table,
} from "@/components/ui";
import { usePreorderEvents, usePreorderOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  computeHourCapacity, computeDayTotals, unassignedParties, hoursWithRoom,
  assignTimeslot, addPreorderOrder, updatePreorderOrder, cancelPreorderOrder,
  restorePreorderOrder, importPreorderOrders, updatePreorderEvent,
  parseImportRows, formatTime, timeToMinutes, minutesToTime,
  type HourSlot, type NewPreorderOrder,
} from "@/lib/api/preorders";
import type { PreorderEvent, PreorderOrder, OrderType } from "@/lib/api/database.types";

const FULFILMENT_LABEL: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

/** How full a seating is, as a colour. Amber from 70%, red once it's full. */
const SLOT_TONE: Record<HourSlot["state"], "green" | "amber" | "rose" | "neutral"> = {
  empty: "neutral",
  ok: "green",
  near: "amber",
  full: "rose",
  over: "rose",
};

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** The seating window as promised to the guest — "14:00" or "11:30–12:30". */
function slotLabel(o: PreorderOrder): string {
  if (!o.timeslot_start) return "—";
  const start = formatTime(o.timeslot_start);
  return o.timeslot_end ? `${start}–${formatTime(o.timeslot_end)}` : start;
}

/** True when a booking doesn't sit cleanly on the hourly grid. */
function isOffGrid(o: PreorderOrder, slotMinutes: number): boolean {
  if (!o.timeslot_start) return false;
  const start = timeToMinutes(o.timeslot_start);
  const end = o.timeslot_end ? timeToMinutes(o.timeslot_end) : start + slotMinutes;
  return start % slotMinutes !== 0 || end - start !== slotMinutes;
}

/** Strip everything but digits and a leading "+" — spaces/dashes in the
 *  stored number are fine for display but can break a dialer's tel: parsing. */
function telHref(phone: string): string {
  return "tel:" + phone.replace(/(?!^\+)[^\d]/g, "");
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function submittedLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Where an order came from, read off `external_id`'s prefix — set by whichever
 * intake produced it (the webhook route, the CSV importer, or left null for a
 * manually added phone order). Purely informational; nothing depends on it.
 */
function orderSource(o: PreorderOrder): { label: string; icon: typeof Globe } {
  const id = o.external_id ?? "";
  if (id.startsWith("csv-")) return { label: "Imported from a spreadsheet", icon: FileSpreadsheet };
  if (id) return { label: "Website form", icon: Globe };
  return { label: "Added by staff", icon: UserRound };
}

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

const PREORDER_CSV_COLUMNS: Array<[string, (o: PreorderOrder) => string | number]> = [
  ["Submitted", (o) => o.created_at],
  ["Name", (o) => o.customer_name],
  ["Email", (o) => o.customer_email ?? ""],
  ["Phone", (o) => o.customer_phone ?? ""],
  ["Date", (o) => o.requested_date],
  ["Covers", (o) => o.quantity],
  ["Type", (o) => FULFILMENT_LABEL[o.fulfillment_type]],
  ["Seating/pickup", (o) => (o.timeslot_start ? slotLabel(o) : "")],
  ["Street", (o) => o.address_street ?? ""],
  ["Apartment", (o) => o.address_apartment ?? ""],
  ["City", (o) => o.address_city ?? ""],
  ["ZIP", (o) => o.address_zip ?? ""],
  ["Addon", (o) => o.addon_qty],
  ["Special requests", (o) => o.special_requests ?? ""],
  ["Total", (o) => o.order_total],
  ["Status", (o) => o.status],
];

function ordersToCSV(rows: PreorderOrder[]): string {
  const header = PREORDER_CSV_COLUMNS.map(([label]) => csvField(label)).join(",");
  const lines = rows.map((o) => PREORDER_CSV_COLUMNS.map(([, get]) => csvField(get(o))).join(","));
  return [header, ...lines].join("\n");
}

export default function Preorders() {
  const { org } = useOrg();
  const fmt = useFmt();
  const invalidate = useInvalidate();

  const { data: events, isLoading: loadingEvents } = usePreorderEvents();
  const activeEvent = useMemo<PreorderEvent | undefined>(
    () => events?.find((e) => e.is_active) ?? events?.[0],
    [events],
  );
  const { data: orders, isLoading: loadingOrders } = usePreorderOrders(activeEvent?.id);

  const [date, setDate] = useState<string | null>(null);
  const [slotFilter, setSlotFilter] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<PreorderOrder | null>(null);

  // Every date the event serves, plus any date an order landed on that isn't
  // configured — an order for an unlisted day must never become invisible.
  const dates = useMemo(() => {
    const set = new Set<string>(activeEvent?.service_dates ?? []);
    for (const o of orders ?? []) set.add(o.requested_date);
    return [...set].sort();
  }, [activeEvent, orders]);

  // Open on the day that needs attention rather than the calendar-first one:
  // an empty first tab hides the day with parties waiting to be seated.
  const defaultDate = useMemo(() => {
    if (dates.length === 0) return null;
    const withOrders = (d: string) => (orders ?? []).filter((o) => o.requested_date === d);
    const needsSeating = dates.find((d) => computeDayTotals(withOrders(d)).coversUnplaced > 0);
    return needsSeating ?? dates.find((d) => withOrders(d).length > 0) ?? dates[0];
  }, [dates, orders]);

  const selectedDate = date && dates.includes(date) ? date : defaultDate;

  const dayOrders = useMemo(
    () => (orders ?? []).filter((o) => o.requested_date === selectedDate),
    [orders, selectedDate],
  );

  const slots = useMemo(
    () => (activeEvent ? computeHourCapacity(activeEvent, dayOrders) : []),
    [activeEvent, dayOrders],
  );
  const queue = useMemo(() => unassignedParties(dayOrders), [dayOrders]);
  const totals = useMemo(() => computeDayTotals(dayOrders), [dayOrders]);
  const takeaway = useMemo(
    () => dayOrders.filter((o) => o.status === "confirmed" && o.fulfillment_type !== "dine_in"),
    [dayOrders],
  );

  const listed = useMemo(() => {
    let rows = dayOrders;
    if (!showCancelled) rows = rows.filter((o) => o.status === "confirmed");
    if (slotFilter !== null) {
      const slot = slots.find((s) => s.startMin === slotFilter);
      const ids = new Set(slot?.parties.map((p) => p.order.id) ?? []);
      rows = rows.filter((o) => ids.has(o.id));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((o) =>
        [o.customer_name, o.customer_email, o.customer_phone]
          .some((v) => (v ?? "").toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [dayOrders, showCancelled, slotFilter, slots, search]);

  const mutate = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
    onSuccess: () => invalidate("preorder_orders", "preorder_events"),
    onError: (e: Error) => toast.error("Couldn't save", e.message),
  });
  const run = (fn: () => Promise<unknown>) => mutate.mutate(fn);

  if (loadingEvents || (activeEvent && loadingOrders)) return <PageSkeleton />;

  if (!activeEvent) {
    return (
      <div className="space-y-6">
        <SectionTitle title="Preorders" subtitle="Event preorders and seating capacity" />
        <EmptyState
          icon={CalendarClock}
          title="No preorder event yet"
          hint="Create an event — like Onam Sadhya — to start taking preorders and tracking seating capacity."
        />
      </div>
    );
  }

  const overbooked = slots.filter((s) => s.state === "over");

  return (
    <div className="space-y-6">
      <SectionTitle
        title={activeEvent.name}
        subtitle={`${activeEvent.dine_in_capacity} covers per seating · ${activeEvent.day_start_hour}:00–${activeEvent.day_end_hour}:00`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="h-4 w-4" /> Settings
            </Button>
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add order
            </Button>
          </div>
        }
      />

      {/* Service dates. Counts and the unplaced dot make the busy day obvious
          before you click into it. */}
      <div className="flex flex-wrap gap-2">
        {dates.map((d) => {
          const t = computeDayTotals((orders ?? []).filter((o) => o.requested_date === d));
          const active = d === selectedDate;
          return (
            <button
              key={d}
              onClick={() => { setDate(d); setSlotFilter(null); }}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-all",
                active
                  ? "border-brand-400/50 bg-brand-400/10 text-white"
                  : "border-line bg-white/[0.03] text-zinc-300 hover:border-zinc-500",
              )}
            >
              <span className="font-semibold">{dayLabel(d)}</span>
              <span className={cn("text-xs", active ? "text-brand-200" : "text-zinc-500")}>
                {t.covers === 0 ? "empty" : `${t.covers} covers`}
              </span>
              {t.coversUnplaced > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-rose-soft" title={`${t.coversUnplaced} covers not seated`} />
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MiniStat icon={Users} label="Covers" value={String(totals.covers)} hint={`${totals.orders} orders`} />
            <MiniStat icon={UtensilsCrossed} label="Seated" value={String(totals.coversSeated)} hint="dine-in placed" />
            <MiniStat
              icon={AlertTriangle}
              label="To seat"
              value={String(totals.coversUnplaced)}
              hint={totals.coversUnplaced > 0 ? "needs a time" : "all placed"}
              urgent={totals.coversUnplaced > 0}
            />
            <MiniStat icon={ShoppingBag} label="Takeaway" value={String(totals.takeawayCovers)} hint={`${totals.takeawayOrders} orders`} />
            <MiniStat icon={Euro} label="Revenue" value={fmt(totals.revenue)} hint="as submitted" />
          </div>

          {overbooked.length > 0 && (
            <Card className="border-rose-soft/30 bg-rose-soft/[0.06] p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-soft" />
                <div className="text-sm">
                  <p className="font-semibold text-rose-soft">
                    {overbooked.length === 1 ? "One seating is over capacity" : `${overbooked.length} seatings are over capacity`}
                  </p>
                  <p className="mt-1 text-zinc-300">
                    {overbooked.map((s) => `${formatTime(minutesToTime(s.startMin))} has ${s.booked} of ${s.capacity}`).join(" · ")}.
                    Move a party to another seating, or raise the capacity in Settings.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {queue.length > 0 && (
            <UnassignedQueue
              event={activeEvent}
              queue={queue}
              dayOrders={dayOrders}
              busy={mutate.isPending}
              onAssign={(id, startMin) =>
                run(async () => {
                  await assignTimeslot(org!.id, id, startMin, activeEvent.slot_minutes);
                  toast.success("Party seated", `${formatTime(minutesToTime(startMin))} confirmed.`);
                })
              }
            />
          )}

          <SeatingGrid
            event={activeEvent}
            slots={slots}
            selected={slotFilter}
            onSelect={(startMin) => setSlotFilter((cur) => (cur === startMin ? null : startMin))}
            allSeated={queue.length === 0 && totals.coversSeated > 0}
          />

          {takeaway.length > 0 && <TakeawayLane orders={takeaway} fmt={fmt} />}

          <OrderList
            event={activeEvent}
            rows={listed}
            dayOrders={dayOrders}
            fmt={fmt}
            search={search}
            onSearch={setSearch}
            showCancelled={showCancelled}
            onToggleCancelled={() => setShowCancelled((v) => !v)}
            slotFilter={slotFilter}
            onClearSlotFilter={() => setSlotFilter(null)}
            busy={mutate.isPending}
            onQuantity={(id, quantity) =>
              run(async () => {
                await updatePreorderOrder(org!.id, id, { quantity });
                toast.success("Party size updated");
              })
            }
            onSeat={(id, startMin) =>
              run(async () => {
                await assignTimeslot(org!.id, id, startMin, activeEvent.slot_minutes);
                toast.success(startMin === null ? "Returned to the queue" : "Party seated");
              })
            }
            onCancel={(id) => run(() => cancelPreorderOrder(org!.id, id))}
            onRestore={(id) => run(() => restorePreorderOrder(org!.id, id))}
            onOpenDetail={setDetailOrder}
          />
        </>
      )}

      <OrderDetailModal
        order={detailOrder}
        event={activeEvent}
        fmt={fmt}
        onClose={() => setDetailOrder(null)}
      />

      <AddOrderModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        event={activeEvent}
        dayOrders={dayOrders}
        defaultDate={selectedDate ?? dates[0] ?? ""}
        dates={dates}
        onSave={(order) =>
          run(async () => {
            await addPreorderOrder(org!.id, activeEvent.id, order);
            setAddOpen(false);
            toast.success("Order added");
          })
        }
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existing={orders ?? []}
        onImport={async (rows) => {
          const res = await importPreorderOrders(org!.id, activeEvent.id, rows);
          invalidate("preorder_orders");
          return res;
        }}
      />

      <EventSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        event={activeEvent}
        onSave={(patch) =>
          run(async () => {
            await updatePreorderEvent(org!.id, activeEvent.id, patch);
            setSettingsOpen(false);
            toast.success("Event updated");
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MiniStat({
  icon: Icon, label, value, hint, urgent = false,
}: {
  icon: typeof Users; label: string; value: string; hint?: string; urgent?: boolean;
}) {
  return (
    <Card className={cn("p-4", urgent && "border-rose-soft/30 bg-rose-soft/[0.06]")}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", urgent ? "text-rose-soft" : "text-zinc-500")} />
        <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</p>
      </div>
      <p className={cn("mt-2 font-display text-2xl font-bold", urgent ? "text-rose-soft" : "text-white")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

/**
 * Parties with no seating time. This sits above the grid because it's the work
 * — most orders arrive without a time, and the grid can't be trusted until
 * this is empty.
 */
function UnassignedQueue({
  event, queue, dayOrders, busy, onAssign,
}: {
  event: PreorderEvent;
  queue: PreorderOrder[];
  dayOrders: PreorderOrder[];
  busy: boolean;
  onAssign: (id: string, startMin: number) => void;
}) {
  const covers = queue.reduce((n, o) => n + o.quantity, 0);

  return (
    <Card className="border-amber-soft/30 bg-amber-soft/[0.04] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-soft" />
          <h2 className="font-display text-lg font-bold text-white">Needs a seating time</h2>
          <Badge tone="amber">{covers} covers · {queue.length} {queue.length === 1 ? "party" : "parties"}</Badge>
        </div>
        <p className="text-xs text-zinc-400">Pick a time to seat each party. Full seatings aren't offered.</p>
      </div>

      <div className="mt-4 space-y-2">
        {queue.map((o) => {
          const options = hoursWithRoom(event, dayOrders, o.quantity, o.id);
          return (
            <div
              key={o.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3"
            >
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg bg-amber-soft/15 px-2 font-display text-base font-bold text-amber-soft">
                {o.quantity}
              </span>
              <div className="min-w-40 flex-1">
                <p className="text-sm font-semibold text-white">{o.customer_name || "Unnamed"}</p>
                <p className="truncate text-xs text-zinc-500">
                  {[o.customer_phone, o.customer_email].filter(Boolean).join(" · ") || "No contact"}
                </p>
              </div>
              {o.special_requests && (
                <Badge tone="violet" className="max-w-52">
                  <MessageSquare className="h-3 w-3 shrink-0" />
                  <span className="truncate">{o.special_requests}</span>
                </Badge>
              )}
              {options.length === 0 ? (
                <Badge tone="rose">No seating fits {o.quantity}</Badge>
              ) : (
                <Select
                  className="w-52"
                  disabled={busy}
                  value=""
                  onChange={(e) => e.target.value && onAssign(o.id, Number(e.target.value))}
                >
                  <option value="">Seat at…</option>
                  {options.map((s) => (
                    <option key={s.startMin} value={s.startMin}>
                      {formatTime(minutesToTime(s.startMin))} · {s.remaining} left
                    </option>
                  ))}
                </Select>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** The hourly seating board for one service date. */
function SeatingGrid({
  event, slots, selected, onSelect, allSeated,
}: {
  event: PreorderEvent;
  slots: HourSlot[];
  selected: number | null;
  onSelect: (startMin: number) => void;
  allSeated: boolean;
}) {
  const hasException = slots.some((s) => s.parties.some((p) => p.isException));

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-white">Seatings</h2>
        {allSeated && (
          <Badge tone="green"><Check className="h-3 w-3" /> Every party has a time</Badge>
        )}
      </div>

      <div className="mt-4 space-y-1.5">
        {slots.map((s) => {
          const tone = SLOT_TONE[s.state];
          const isSelected = selected === s.startMin;
          return (
            <button
              key={s.startMin}
              onClick={() => onSelect(s.startMin)}
              className={cn(
                "flex w-full cursor-pointer flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                isSelected ? "border-brand-400/50 bg-brand-400/[0.07]" : "border-line hover:border-zinc-600 hover:bg-white/[0.03]",
                s.state === "over" && !isSelected && "border-rose-soft/40 bg-rose-soft/[0.05]",
              )}
            >
              <span className="w-14 font-mono text-sm font-semibold text-zinc-200">
                {formatTime(minutesToTime(s.startMin))}
              </span>

              <div className="w-32 shrink-0">
                <ProgressBar
                  value={(s.booked / Math.max(1, s.capacity)) * 100}
                  tone={tone === "neutral" ? "green" : tone === "rose" ? "rose" : tone === "amber" ? "amber" : "green"}
                />
              </div>

              <span className={cn("w-20 text-sm tabular-nums", s.state === "over" ? "text-rose-soft" : "text-zinc-300")}>
                {s.booked} / {s.capacity}
              </span>

              <span className="w-16 text-xs text-zinc-500">
                {s.state === "empty" ? "open"
                  : s.remaining > 0 ? `${s.remaining} left`
                  : s.remaining === 0 ? "full"
                  : `${-s.remaining} over`}
              </span>

              <div className="flex flex-1 flex-wrap items-center gap-1.5">
                {s.parties.map((p) => (
                  <span
                    key={p.order.id}
                    title={p.isException ? `Booked ${slotLabel(p.order)} — covers two seatings` : undefined}
                  >
                    <Badge tone={p.isException ? "violet" : "neutral"}>
                      {p.order.customer_name || "Unnamed"} · {p.order.quantity}
                      {p.isException && <span className="opacity-70">({slotLabel(p.order)})</span>}
                    </Badge>
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {hasException && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-zinc-500">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-soft" />
          A party booked outside the hourly grid shows in both seatings it covers, with its real
          time. It's one booking counted once per seating — not two.
        </p>
      )}
    </Card>
  );
}

/** Takeaway occupies no seats, but the kitchen still has to produce it. */
function TakeawayLane({ orders, fmt }: { orders: PreorderOrder[]; fmt: (n: number) => string }) {
  const byHour = new Map<string, PreorderOrder[]>();
  for (const o of orders) {
    const key = o.timeslot_start ? formatTime(o.timeslot_start) : "No time";
    byHour.set(key, [...(byHour.get(key) ?? []), o]);
  }
  const hours = [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b));
  const covers = orders.reduce((n, o) => n + o.quantity, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-zinc-500" />
          <h2 className="font-display text-lg font-bold text-white">Takeaway</h2>
          <Badge>{covers} covers</Badge>
        </div>
        <p className="text-xs text-zinc-500">Pickup times — no seats used</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {hours.map(([hour, rows]) => (
          <div key={hour} className="rounded-xl border border-line bg-white/[0.02] px-4 py-3">
            <p className="font-mono text-sm font-semibold text-zinc-200">{hour}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {rows.reduce((n, o) => n + o.quantity, 0)} covers · {fmt(rows.reduce((n, o) => n + Number(o.order_total || 0), 0))}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {rows.map((o) => (
                <Badge key={o.id}>{o.customer_name || "Unnamed"} · {o.quantity}</Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Every order for the date, with the edits staff actually make by phone. */
function OrderList({
  event, rows, dayOrders, fmt, search, onSearch, showCancelled, onToggleCancelled,
  slotFilter, onClearSlotFilter, busy, onQuantity, onSeat, onCancel, onRestore, onOpenDetail,
}: {
  event: PreorderEvent;
  rows: PreorderOrder[];
  dayOrders: PreorderOrder[];
  fmt: (n: number) => string;
  search: string;
  onSearch: (v: string) => void;
  showCancelled: boolean;
  onToggleCancelled: () => void;
  slotFilter: number | null;
  onClearSlotFilter: () => void;
  busy: boolean;
  onQuantity: (id: string, quantity: number) => void;
  onSeat: (id: string, startMin: number | null) => void;
  onCancel: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenDetail: (order: PreorderOrder) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = (o: PreorderOrder) => {
    const next = Number(draft);
    setEditing(null);
    if (!Number.isFinite(next) || next < 1 || next === o.quantity) return;

    // Warn before a quantity change tips a seating over, but let it through —
    // the restaurant may knowingly squeeze a party in.
    if (o.fulfillment_type === "dine_in" && o.timeslot_start) {
      const start = timeToMinutes(o.timeslot_start);
      const after = computeHourCapacity(
        event,
        dayOrders.map((r) => (r.id === o.id ? { ...r, quantity: next } : r)),
      ).find((s) => s.startMin === Math.floor(start / 60) * 60);
      if (after && after.booked > after.capacity) {
        const ok = window.confirm(
          `${formatTime(minutesToTime(after.startMin))} would hold ${after.booked} covers, ` +
          `${after.booked - after.capacity} over the ${after.capacity} capacity.\n\nSave anyway?`,
        );
        if (!ok) return;
      }
    }
    onQuantity(o.id, next);
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold text-white">Orders</h2>
          {slotFilter !== null && (
            <button
              onClick={onClearSlotFilter}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-brand-400/10 px-2.5 py-0.5 text-xs font-medium text-brand-300 ring-1 ring-brand-400/30 hover:bg-brand-400/20"
            >
              {formatTime(minutesToTime(slotFilter))} seating <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search name, email, phone"
              className="w-60 pl-9"
            />
          </div>
          <Button variant="ghost" onClick={onToggleCancelled}>
            {showCancelled ? "Hide cancelled" : "Show cancelled"}
          </Button>
          <Button
            variant="ghost"
            disabled={rows.length === 0}
            onClick={() => downloadFile(ordersToCSV(rows), `preorders-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv")}
            title={`Export ${rows.length} order${rows.length === 1 ? "" : "s"} shown below as CSV`}
          >
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No orders here" hint="Try clearing the search or the seating filter." />
        ) : (
          <Table headers={["Guest", "Covers", "Type", "Seating", "Addon", "Total", ""]}>
            {rows.map((o) => {
              const cancelled = o.status === "cancelled";
              const options = hoursWithRoom(event, dayOrders, o.quantity, o.id);
              return (
                <tr key={o.id} className={cn("align-top", cancelled && "opacity-50")}>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onOpenDetail(o)}
                      className={cn(
                        "group inline-flex cursor-pointer items-center gap-1.5 font-medium text-white hover:text-brand-300",
                        cancelled && "line-through",
                      )}
                      title="View full order details"
                    >
                      {o.customer_name || "Unnamed"}
                      <Eye className="h-3 w-3 shrink-0 text-zinc-600 group-hover:text-brand-300" />
                    </button>

                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                      {o.customer_phone && (
                        <a href={telHref(o.customer_phone)} className="hover:text-brand-300" onClick={(e) => e.stopPropagation()}>
                          {o.customer_phone}
                        </a>
                      )}
                      {o.customer_email && (
                        <a href={`mailto:${o.customer_email}`} className="hover:text-brand-300" onClick={(e) => e.stopPropagation()}>
                          {o.customer_email}
                        </a>
                      )}
                      {!o.customer_phone && !o.customer_email && "No contact"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-600">Submitted {timeAgo(o.created_at)}</p>

                    {(o.address_street || o.address_city) && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-zinc-500">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        {[o.address_street, o.address_apartment, o.address_zip, o.address_city]
                          .filter(Boolean).join(", ")}
                      </p>
                    )}
                    {o.special_requests && (
                      <p className="mt-1 line-clamp-2 flex items-start gap-1 text-xs text-violet-soft">
                        <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                        {o.special_requests}
                      </p>
                    )}
                  </td>

                  {/* Party size is edited here rather than by re-importing —
                      guests change their count by phone all the time. */}
                  <td className="px-4 py-3">
                    {editing === o.id ? (
                      <Input
                        autoFocus
                        type="number"
                        min={1}
                        value={draft}
                        disabled={busy}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => commit(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commit(o);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-20"
                      />
                    ) : (
                      <button
                        disabled={cancelled || busy}
                        onClick={() => { setEditing(o.id); setDraft(String(o.quantity)); }}
                        className="cursor-pointer rounded-lg px-2 py-1 font-display text-base font-bold text-white hover:bg-white/10 disabled:cursor-default disabled:hover:bg-transparent"
                        title="Click to change the party size"
                      >
                        {o.quantity}
                      </button>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <Badge tone={o.fulfillment_type === "dine_in" ? "cyan" : "neutral"}>
                      {FULFILMENT_LABEL[o.fulfillment_type]}
                    </Badge>
                  </td>

                  <td className="px-4 py-3">
                    {o.fulfillment_type !== "dine_in" ? (
                      <span className="text-sm text-zinc-400">{slotLabel(o)}</span>
                    ) : cancelled ? (
                      <span className="text-sm text-zinc-500">{slotLabel(o)}</span>
                    ) : (
                      <div className="space-y-1">
                        <Select
                          className="w-40"
                          disabled={busy}
                          value={o.timeslot_start ? String(Math.floor(timeToMinutes(o.timeslot_start) / 60) * 60) : ""}
                          onChange={(e) => onSeat(o.id, e.target.value === "" ? null : Number(e.target.value))}
                        >
                          <option value="">Not seated</option>
                          {/* The current seating stays listed even when full,
                              so re-opening the dropdown doesn't look like the
                              booking was lost. */}
                          {o.timeslot_start && !options.some((s) => s.startMin === Math.floor(timeToMinutes(o.timeslot_start!) / 60) * 60) && (
                            <option value={Math.floor(timeToMinutes(o.timeslot_start) / 60) * 60}>
                              {slotLabel(o)} (current)
                            </option>
                          )}
                          {options.map((s) => (
                            <option key={s.startMin} value={s.startMin}>
                              {formatTime(minutesToTime(s.startMin))} · {s.remaining} left
                            </option>
                          ))}
                        </Select>
                        {isOffGrid(o, event.slot_minutes) && (
                          <Badge tone="violet">Booked {slotLabel(o)}</Badge>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3 text-sm text-zinc-400">{o.addon_qty || "—"}</td>
                  <td className="px-4 py-3 text-sm text-zinc-300 tabular-nums">{fmt(Number(o.order_total) || 0)}</td>
                  <td className="px-4 py-3 text-right">
                    {cancelled ? (
                      <Button variant="ghost" disabled={busy} onClick={() => onRestore(o.id)}>
                        <Undo2 className="h-4 w-4" /> Restore
                      </Button>
                    ) : (
                      <Button variant="danger" disabled={busy} onClick={() => onCancel(o.id)}>
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>
    </Card>
  );
}

/** Staff entry for phone orders. */
function AddOrderModal({
  open, onClose, event, dayOrders, defaultDate, dates, onSave,
}: {
  open: boolean;
  onClose: () => void;
  event: PreorderEvent;
  dayOrders: PreorderOrder[];
  defaultDate: string;
  dates: string[];
  onSave: (order: NewPreorderOrder) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [quantity, setQuantity] = useState("2");
  const [type, setType] = useState<OrderType>("dine_in");
  const [startMin, setStartMin] = useState("");
  const [addon, setAddon] = useState("0");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");

  const qty = Number(quantity) || 0;
  const sameDay = dayOrders.filter((o) => o.requested_date === date);
  const options = qty > 0 ? hoursWithRoom(event, sameDay, qty) : [];
  const valid = name.trim() !== "" && date !== "" && qty >= 1;

  const submit = () => {
    if (!valid) return;
    const start = startMin === "" ? null : minutesToTime(Number(startMin));
    onSave({
      customer_name: name.trim(),
      customer_phone: phone.trim() || null,
      customer_email: email.trim() || null,
      requested_date: date,
      quantity: qty,
      fulfillment_type: type,
      timeslot_start: start,
      timeslot_end: type === "dine_in" && start ? minutesToTime(Number(startMin) + event.slot_minutes) : null,
      addon_qty: Number(addon) || 0,
      order_total: Number(total) || 0,
      special_requests: notes.trim() || null,
    });
    setName(""); setPhone(""); setEmail(""); setQuantity("2");
    setStartMin(""); setAddon("0"); setTotal(""); setNotes("");
  };

  return (
    <Modal open={open} onClose={onClose} title="Add a preorder">
      <div className="space-y-4">
        <Field label="Guest name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who's ordering?" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Service date">
            <Select value={date} onChange={(e) => { setDate(e.target.value); setStartMin(""); }}>
              {dates.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </Select>
          </Field>
          <Field label="Sadhyas">
            <Input type="number" min={1} value={quantity}
              onChange={(e) => { setQuantity(e.target.value); setStartMin(""); }} />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => { setType(e.target.value as OrderType); setStartMin(""); }}>
              <option value="dine_in">Dine-in</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </Select>
          </Field>
        </div>

        <Field label={type === "dine_in" ? "Seating" : "Pickup time"}>
          {type === "dine_in" ? (
            <>
              <Select value={startMin} onChange={(e) => setStartMin(e.target.value)}>
                <option value="">Decide later — add to the queue</option>
                {options.map((s) => (
                  <option key={s.startMin} value={s.startMin}>
                    {formatTime(minutesToTime(s.startMin))} · {s.remaining} left
                  </option>
                ))}
              </Select>
              {qty > 0 && options.length === 0 && (
                <p className="mt-1.5 text-xs text-rose-soft">
                  No seating on {dayLabel(date)} has room for {qty}. Add it to the queue and free up space first.
                </p>
              )}
            </>
          ) : (
            <Select value={startMin} onChange={(e) => setStartMin(e.target.value)}>
              <option value="">No time set</option>
              {Array.from({ length: event.day_end_hour - event.day_start_hour }, (_, i) => {
                const h = event.day_start_hour + i;
                return <option key={h} value={h * 60}>{String(h).padStart(2, "0")}:00</option>;
              })}
            </Select>
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Real Leaf addon"><Input type="number" min={0} value={addon} onChange={(e) => setAddon(e.target.value)} /></Field>
          <Field label="Order total"><Input type="number" min={0} step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" /></Field>
        </div>

        <Field label="Special requests">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Kids seats, allergies…" />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={submit}>Add order</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Paste the website form's export straight from a spreadsheet. */
function ImportModal({
  open, onClose, existing, onImport,
}: {
  open: boolean;
  onClose: () => void;
  existing: PreorderOrder[];
  onImport: (rows: NewPreorderOrder[]) => Promise<{ inserted: number; updated: number }>;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseImportRows(text) : null), [text]);

  // An import overwrites whatever the row says — so a stale export would undo
  // party sizes staff changed by phone. Name those rows before it happens.
  const conflicts = useMemo(() => {
    if (!parsed) return [];
    const byExternal = new Map(existing.filter((o) => o.external_id).map((o) => [o.external_id!, o]));
    return parsed.rows.flatMap((r) => {
      const current = r.external_id ? byExternal.get(r.external_id) : undefined;
      if (!current || current.quantity === r.quantity) return [];
      return [{ name: r.customer_name || "Unnamed", from: current.quantity, to: r.quantity ?? 0 }];
    });
  }, [parsed, existing]);

  const submit = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setSaving(true);
    try {
      const res = await onImport(parsed.rows);
      toast.success(
        "Import complete",
        `${res.inserted} added, ${res.updated} updated${parsed.errors.length ? `, ${parsed.errors.length} skipped` : ""}.`,
      );
      setText("");
      onClose();
    } catch (e) {
      toast.error("Import failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import preorders" wide>
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Select the rows in your form export — including the header row — and paste them here.
          Columns are matched by their headings, so the order doesn't matter. Importing the same
          rows twice updates them rather than duplicating.
        </p>

        <Textarea
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Submission Time\tName\tEmail Address\t…\n\nPaste here"}
          className="font-mono text-xs"
        />

        {parsed && parsed.missingColumns.length > 0 && (
          <Card className="border-rose-soft/30 bg-rose-soft/[0.06] p-3">
            <p className="text-sm text-rose-soft">
              Missing required columns: {parsed.missingColumns.join(", ")}.
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              The paste needs at least Name, Choose Date, Number and the fulfillment column, with
              the header row included.
            </p>
          </Card>
        )}

        {parsed && parsed.rows.length > 0 && (
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green"><Check className="h-3 w-3" /> {parsed.rows.length} orders ready</Badge>
              <Badge>
                {parsed.rows.reduce((n, r) => n + (r.quantity ?? 0), 0)} covers
              </Badge>
              <Badge>
                {parsed.rows.filter((r) => r.fulfillment_type === "dine_in").length} dine-in
              </Badge>
              {parsed.errors.length > 0 && <Badge tone="rose">{parsed.errors.length} skipped</Badge>}
            </div>

            <div className="mt-3 max-h-48 overflow-y-auto">
              <Table headers={["Guest", "Date", "Covers", "Type", "Time"]}>
                {parsed.rows.slice(0, 30).map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-white">{r.customer_name}</td>
                    <td className="px-4 py-2 text-zinc-400">{r.requested_date}</td>
                    <td className="px-4 py-2 text-zinc-300">{r.quantity}</td>
                    <td className="px-4 py-2 text-zinc-400">{FULFILMENT_LABEL[r.fulfillment_type]}</td>
                    <td className="px-4 py-2 text-zinc-400">
                      {r.timeslot_start
                        ? `${formatTime(r.timeslot_start)}${r.timeslot_end ? `–${formatTime(r.timeslot_end)}` : ""}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        )}

        {conflicts.length > 0 && (
          <Card className="border-amber-soft/30 bg-amber-soft/[0.06] p-3">
            <p className="text-sm font-medium text-amber-soft">
              {conflicts.length === 1
                ? "One party size will be overwritten"
                : `${conflicts.length} party sizes will be overwritten`}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              These already exist with a different number of sadhyas. Importing replaces what's in
              the app — if the change was made here by phone, re-export from the website first.
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-zinc-300">
              {conflicts.map((c, i) => (
                <li key={i}>
                  {c.name}: <span className="text-white">{c.from}</span> → <span className="text-amber-soft">{c.to}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {parsed && parsed.errors.length > 0 && (
          <Card className="border-amber-soft/30 bg-amber-soft/[0.06] p-3">
            <p className="text-sm font-medium text-amber-soft">These rows were skipped</p>
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
              {parsed.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </Card>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!parsed || parsed.rows.length === 0 || saving} onClick={submit}>
            {saving ? "Importing…" : `Import ${parsed?.rows.length ?? 0} orders`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Capacity, service window, dates, and the website hookup. */
function EventSettingsModal({
  open, onClose, event, onSave,
}: {
  open: boolean;
  onClose: () => void;
  event: PreorderEvent;
  onSave: (patch: Partial<PreorderEvent>) => void;
}) {
  const [name, setName] = useState(event.name);
  const [capacity, setCapacity] = useState(String(event.dine_in_capacity));
  const [startHour, setStartHour] = useState(String(event.day_start_hour));
  const [endHour, setEndHour] = useState(String(event.day_end_hour));
  const [dates, setDates] = useState((event.service_dates ?? []).join(", "));
  const [copied, setCopied] = useState(false);

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/preorders/${event.id}?secret=${event.webhook_secret}`
      : "";

  const submit = () => {
    onSave({
      name: name.trim() || event.name,
      dine_in_capacity: Math.max(1, Number(capacity) || event.dine_in_capacity),
      day_start_hour: Math.min(23, Math.max(0, Number(startHour) || event.day_start_hour)),
      day_end_hour: Math.min(24, Math.max(1, Number(endHour) || event.day_end_hour)),
      service_dates: dates.split(",").map((d) => d.trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Event settings">
      <div className="space-y-4">
        <Field label="Event name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Covers per seating">
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>
          <Field label="First seating">
            <Input type="number" min={0} max={23} value={startHour} onChange={(e) => setStartHour(e.target.value)} />
          </Field>
          <Field label="Service ends">
            <Input type="number" min={1} max={24} value={endHour} onChange={(e) => setEndHour(e.target.value)} />
          </Field>
        </div>

        <Field label="Service dates">
          <Input value={dates} onChange={(e) => setDates(e.target.value)} placeholder="2026-08-22, 2026-08-26" />
        </Field>
        <p className="-mt-2 text-xs text-zinc-500">
          Comma-separated, as YYYY-MM-DD. A date listed here gets a tab even before any order
          arrives, so an empty service is still visible.
        </p>

        <div className="rounded-xl border border-line bg-white/[0.02] p-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-zinc-500" />
            <p className="text-sm font-medium text-white">Website form hookup</p>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Point the website form's webhook at this URL and new submissions land here
            automatically. It contains this event's secret — treat it like a password.
          </p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={webhookUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(webhookUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  toast.error("Couldn't copy", "Select the URL and copy it manually.");
                }
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : "Copy"}
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Everything about one order in one place — the thing a spreadsheet gives you
 * for free (every column, right there) that a compact table row can't. Opens
 * from clicking a guest's name in the order list.
 */
function OrderDetailModal({
  order, event, fmt, onClose,
}: {
  order: PreorderOrder | null;
  event: PreorderEvent;
  fmt: (n: number) => string;
  onClose: () => void;
}) {
  if (!order) return null;
  const source = orderSource(order);
  const cancelled = order.status === "cancelled";

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-100">{children}</span>
    </div>
  );

  return (
    <Modal open={!!order} onClose={onClose} title={order.customer_name || "Unnamed guest"}>
      <div className="space-y-1 divide-y divide-line/60">
        <Row label="Status">
          <div className="flex items-center gap-2">
            <Badge tone={cancelled ? "rose" : "green"}>{cancelled ? "Cancelled" : "Confirmed"}</Badge>
            <Badge tone={order.fulfillment_type === "dine_in" ? "cyan" : "neutral"}>
              {FULFILMENT_LABEL[order.fulfillment_type]}
            </Badge>
          </div>
        </Row>

        <Row label="Contact">
          <div className="space-y-1">
            {order.customer_phone ? (
              <a href={telHref(order.customer_phone)} className="flex items-center gap-1.5 hover:text-brand-300">
                <Phone className="h-3.5 w-3.5 text-zinc-500" /> {order.customer_phone}
              </a>
            ) : (
              <p className="text-zinc-500">No phone</p>
            )}
            {order.customer_email ? (
              <a href={`mailto:${order.customer_email}`} className="flex items-center gap-1.5 hover:text-brand-300">
                <Mail className="h-3.5 w-3.5 text-zinc-500" /> {order.customer_email}
              </a>
            ) : (
              <p className="text-zinc-500">No email</p>
            )}
          </div>
        </Row>

        <Row label="Service date">{dayLabel(order.requested_date)}</Row>

        <Row label={order.fulfillment_type === "dine_in" ? "Seating" : "Pickup"}>
          {order.timeslot_start ? (
            <span className="flex items-center gap-2">
              {slotLabel(order)}
              {isOffGrid(order, event.slot_minutes) && <Badge tone="violet">Off the hourly grid</Badge>}
            </span>
          ) : (
            <span className="text-amber-soft">Not yet placed</span>
          )}
        </Row>

        <Row label="Covers">
          <span className="font-display text-base font-bold">{order.quantity}</span> sadhya{order.quantity === 1 ? "" : "s"}
          {order.addon_qty > 0 && <span className="text-zinc-400"> · {order.addon_qty} Real Leaf addon</span>}
        </Row>

        {(order.address_street || order.address_city) && (
          <Row label="Address">
            <div className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span>
                {[order.address_street, order.address_apartment].filter(Boolean).join(", ")}
                {(order.address_street || order.address_apartment) && (order.address_zip || order.address_city) ? <br /> : null}
                {[order.address_zip, order.address_city].filter(Boolean).join(" ")}
              </span>
            </div>
          </Row>
        )}

        {order.special_requests && (
          <Row label="Special requests">
            <span className="whitespace-pre-wrap text-violet-soft">{order.special_requests}</span>
          </Row>
        )}

        <Row label="Total">
          <span className="font-display text-base font-bold">{fmt(Number(order.order_total) || 0)}</span>
          <span className="ml-2 text-xs text-zinc-500">as submitted — not recalculated on edits</span>
        </Row>

        <Row label="Submitted">
          {submittedLabel(order.created_at)}
          <span className="ml-1 text-zinc-500">({timeAgo(order.created_at)})</span>
        </Row>

        <Row label="Source">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <source.icon className="h-3.5 w-3.5" /> {source.label}
          </span>
        </Row>
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
