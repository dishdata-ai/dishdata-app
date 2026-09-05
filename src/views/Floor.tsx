import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, CalendarClock, Armchair, Users, Phone, QrCode, Printer, ShoppingBag } from "lucide-react";
import {
  Card,
  SectionTitle,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { QrCode as QrCodeImage } from "@/components/QrCode";
import { QrSheetModal } from "@/components/QrSheet";
import { useTables, useReservations, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { setTableStatus, addTable, createReservation, setReservationStatus } from "@/lib/api/service";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus, Reservation, ReservationStatus } from "@/lib/api/database.types";

const tableTone: Record<TableStatus, { ring: string; bg: string; label: string }> = {
  open: { ring: "ring-brand-400/40", bg: "bg-brand-400/5", label: "Open" },
  seated: { ring: "ring-rose-soft/40", bg: "bg-rose-soft/5", label: "Seated" },
  reserved: { ring: "ring-violet-soft/40", bg: "bg-violet-soft/5", label: "Reserved" },
  cleaning: { ring: "ring-amber-soft/40", bg: "bg-amber-soft/5", label: "Cleaning" },
};

const NEXT_TABLE_STATUS: Record<TableStatus, TableStatus> = {
  open: "seated",
  seated: "cleaning",
  cleaning: "open",
  reserved: "seated",
};

const resTone: Record<ReservationStatus, "cyan" | "green" | "neutral" | "rose" | "amber"> = {
  booked: "cyan",
  seated: "green",
  completed: "neutral",
  no_show: "rose",
  cancelled: "amber",
};

function NewReservationForm({ tables, onDone }: { tables: RestaurantTable[]; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    guest: "",
    phone: "",
    party: "2",
    date: new Date().toISOString().slice(0, 10),
    time: "19:00",
    tableId: "",
    note: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      createReservation(org!.id, {
        guest_name: form.guest.trim(),
        phone: form.phone.trim() || null,
        party_size: +form.party || 2,
        starts_at: new Date(`${form.date}T${form.time}`).toISOString(),
        table_id: form.tableId || null,
        note: form.note.trim() || null,
      }),
    onSuccess: () => {
      invalidate("reservations", "restaurant_tables");
      toast.success("Reservation booked", `${form.guest.trim()} · party of ${form.party}`);
      onDone();
    },
    onError: (e) => toast.error("Could not book", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Guest name">
          <Input value={form.guest} onChange={set("guest")} placeholder="Guest name" autoFocus />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set("phone")} placeholder="+1 555 0100" />
        </Field>
        <Field label="Date">
          <Input type="date" value={form.date} onChange={set("date")} />
        </Field>
        <Field label="Time">
          <Input type="time" value={form.time} onChange={set("time")} />
        </Field>
        <Field label="Party size">
          <Input type="number" min="1" max="30" value={form.party} onChange={set("party")} />
        </Field>
        <Field label="Table (optional)">
          <Select value={form.tableId} onChange={set("tableId")}>
            <option value="">Assign later</option>
            {tables
              .filter((t) => t.status === "open")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.seats} seats · {t.zone}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <Input value={form.note} onChange={set("note")} placeholder="Birthday, window seat…" />
      </Field>
      <Button className="w-full" disabled={!form.guest.trim() || create.isPending} onClick={() => create.mutate()}>
        Book Reservation
      </Button>
    </div>
  );
}

export default function Floor() {
  const { org } = useOrg();
  const tablesQ = useTables();
  const reservationsQ = useReservations();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("reservations", ["reservations", "restaurant_tables"]);

  const [booking, setBooking] = useState(false);
  const [addingTable, setAddingTable] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [printingTakeawaySheet, setPrintingTakeawaySheet] = useState(false);
  const [tableForm, setTableForm] = useState({ name: "", seats: "4", zone: "Main" });

  const tables = tablesQ.data ?? [];
  const reservations = (reservationsQ.data ?? []).filter(
    (r) => r.status === "booked" || r.status === "seated",
  );

  const zones = useMemo(() => [...new Set(tables.map((t) => t.zone))], [tables]);
  const seatedCount = tables.filter((t) => t.status === "seated").length;

  const cycleTable = async (t: RestaurantTable) => {
    const next = NEXT_TABLE_STATUS[t.status];
    try {
      await setTableStatus(org!.id, t.id, next);
      invalidate("restaurant_tables");
    } catch (e) {
      toast.error("Could not update table", e instanceof Error ? e.message : "");
    }
  };

  const updateReservation = async (r: Reservation, status: ReservationStatus) => {
    try {
      await setReservationStatus(org!.id, r, status);
      invalidate("reservations", "restaurant_tables");
      toast.success(`${r.guest_name} — ${status.replace("_", " ")}`);
    } catch (e) {
      toast.error("Could not update reservation", e instanceof Error ? e.message : "");
    }
  };

  if (tablesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Floor & Reservations"
        subtitle="Tap a table to cycle it: open → seated → cleaning → open."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setShowQr(true)}>
              <QrCode className="h-4 w-4" /> QR Codes
            </Button>
            <Button variant="ghost" onClick={() => setAddingTable(true)}>
              <Plus className="h-4 w-4" /> Table
            </Button>
            <Button onClick={() => setBooking(true)}>
              <CalendarClock className="h-4 w-4" /> New Reservation
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        {(Object.keys(tableTone) as TableStatus[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
            <span className={cn("h-2.5 w-2.5 rounded-full ring-2", tableTone[s].ring, tableTone[s].bg)} />
            {tableTone[s].label}
          </span>
        ))}
        <Badge tone="cyan" className="ml-auto">
          {seatedCount}/{tables.length} tables seated
        </Badge>
      </div>

      {tables.length === 0 ? (
        <Card>
          <EmptyState
            icon={Armchair}
            title="No tables configured"
            hint="Add your floor plan — tables become selectable at POS checkout and for reservations."
            action={
              <Button onClick={() => setAddingTable(true)}>
                <Plus className="h-4 w-4" /> Add Table
              </Button>
            }
          />
        </Card>
      ) : (
        zones.map((zone) => (
          <div key={zone}>
            <p className="mb-2 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{zone}</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {tables
                .filter((t) => t.zone === zone)
                .map((t) => {
                  const tone = tableTone[t.status];
                  return (
                    <button
                      key={t.id}
                      onClick={() => cycleTable(t)}
                      className={cn(
                        "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl ring-2 transition-all hover:scale-[1.04] active:scale-95",
                        tone.ring,
                        tone.bg,
                      )}
                      title={`${t.name} — ${tone.label}. Click to change.`}
                    >
                      <span className="font-display text-lg font-bold text-white">{t.name}</span>
                      <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                        <Users className="h-3 w-3" /> {t.seats}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))
      )}

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Upcoming Reservations</h3>
          <p className="text-xs text-zinc-500">Booked and currently seated</p>
        </div>
        {reservations.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No upcoming reservations"
            hint="Bookings made here or through your public page show up instantly."
          />
        ) : (
          <div className="divide-y divide-line/60">
            {reservations.map((r) => {
              const table = tables.find((t) => t.id === r.table_id);
              const when = new Date(r.starts_at);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-white">
                      {r.guest_name}
                      <span className="ml-2 text-xs text-zinc-500">party of {r.party_size}</span>
                      {r.source === "public" && <Badge tone="violet" className="ml-2">online</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}{" "}
                      {when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      {table ? ` · ${table.name}` : ""}
                      {r.phone ? (
                        <span className="ml-2 inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {r.phone}
                        </span>
                      ) : null}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                  <Badge tone={resTone[r.status]} className="capitalize">{r.status.replace("_", " ")}</Badge>
                  <div className="flex gap-1.5">
                    {r.status === "booked" && (
                      <>
                        <Button className="px-3 py-1.5 text-xs" onClick={() => updateReservation(r, "seated")}>
                          Seat
                        </Button>
                        <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => updateReservation(r, "no_show")}>
                          No-show
                        </Button>
                      </>
                    )}
                    {r.status === "seated" && (
                      <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => updateReservation(r, "completed")}>
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* QR codes for table ordering + takeaway */}
      <Modal open={showQr} onClose={() => setShowQr(false)} title="QR codes — scan to order" wide>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Print these and place one on each table, plus the takeaway one at the counter or front door.
            Guests scan to browse your menu and order straight to the kitchen — no app needed.
          </p>
          <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3" id="qr-grid">
            <div className="rounded-xl border border-line bg-white p-3 text-center">
              <QrCodeImage
                value={`${window.location.origin}/r/${org?.slug}?order=takeaway`}
                size={112}
                className="mx-auto"
              />
              <p className="mt-1.5 flex items-center justify-center gap-1 font-display text-sm font-bold text-zinc-900">
                <ShoppingBag className="h-3.5 w-3.5" /> Takeaway
              </p>
              <p className="text-[10px] text-zinc-500">Scan to order for pickup</p>
              <button
                onClick={() => setPrintingTakeawaySheet(true)}
                className="mt-1.5 cursor-pointer text-[10px] font-semibold text-brand-500 underline underline-offset-2"
              >
                Print 10 for cutting
              </button>
            </div>
            {tables.map((t) => {
              const url = `${window.location.origin}/r/${org?.slug}?table=${encodeURIComponent(t.name)}`;
              return (
                <div key={t.id} className="rounded-xl border border-line bg-white p-3 text-center">
                  <QrCodeImage value={url} size={112} className="mx-auto" />
                  <p className="mt-1.5 font-display text-sm font-bold text-zinc-900">Table {t.name}</p>
                  <p className="text-[10px] text-zinc-500">Scan to order</p>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" className="w-full" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print QR sheet
          </Button>
        </div>
      </Modal>

      <QrSheetModal
        open={printingTakeawaySheet}
        onClose={() => setPrintingTakeawaySheet(false)}
        value={`${typeof window !== "undefined" ? window.location.origin : ""}/r/${org?.slug}?order=takeaway`}
        title="Scan to order"
      />

      <Modal open={booking} onClose={() => setBooking(false)} title="New Reservation" wide>
        <NewReservationForm tables={tables} onDone={() => setBooking(false)} />
      </Modal>

      <Modal open={addingTable} onClose={() => setAddingTable(false)} title="Add Table">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name">
              <Input value={tableForm.name} onChange={(e) => setTableForm((f) => ({ ...f, name: e.target.value }))} placeholder="T9" />
            </Field>
            <Field label="Seats">
              <Input type="number" min="1" value={tableForm.seats} onChange={(e) => setTableForm((f) => ({ ...f, seats: e.target.value }))} />
            </Field>
            <Field label="Zone">
              <Input value={tableForm.zone} onChange={(e) => setTableForm((f) => ({ ...f, zone: e.target.value }))} placeholder="Main" />
            </Field>
          </div>
          <Button
            className="w-full"
            disabled={!tableForm.name.trim()}
            onClick={async () => {
              try {
                await addTable(org!.id, tableForm.name.trim(), +tableForm.seats || 4, tableForm.zone.trim() || "Main");
                invalidate("restaurant_tables");
                toast.success("Table added", tableForm.name.trim());
                setAddingTable(false);
                setTableForm({ name: "", seats: "4", zone: "Main" });
              } catch (e) {
                toast.error("Could not add table", e instanceof Error ? e.message : "");
              }
            }}
          >
            Add Table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
