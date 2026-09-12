import { useRef, useState, useEffect } from "react";
import { Check, Upload, Trash2, Puzzle, Truck, Plus, X, Percent, Printer, MapPin, LocateFixed } from "lucide-react";
import { Card, SectionTitle, Button, Badge, Input, Field, Select } from "@/components/ui";
import { PaymentsCard } from "@/components/PaymentsCard";
import { useOrg } from "@/lib/hooks/useOrg";
import { useEmployees, useInvalidate } from "@/lib/hooks/data";
import { updateEmployee } from "@/lib/api/people";
import type { Employee } from "@/lib/api/database.types";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateOrg, uploadOrgAsset } from "@/lib/api/orgs";
import { printViaEpos } from "@/lib/escpos";
import { getPrinterConfig, type PrinterConfig } from "@/lib/printer";
import { clearDemoData } from "@/lib/api/demoDb";
import { MODULES, MODULE_GROUPS, ALWAYS_ENABLED_MODULES } from "@/lib/modules";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import { getCurrentPosition, GeoError } from "@/lib/geo";
import {
  listDeliveryZones,
  upsertDeliveryZone,
  deleteDeliveryZone,
  type DeliveryZone,
} from "@/lib/api/delivery_zones";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "SGD"];
const ACCENTS = [null, "#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa"];

/**
 * Receipt printer — an Epson TM with ePOS-Print talks HTTP on the local
 * network, so the browser can print to it directly with no dialog and nothing
 * installed on the till. Works on iPad too, where WebUSB doesn't exist.
 */
function ReceiptPrinterCard({ isAdmin }: { isAdmin: boolean }) {
  const { org, refresh } = useOrg();
  const [cfg, setCfg] = useState<PrinterConfig>(() => getPrinterConfig(org));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const set = <K extends keyof PrinterConfig>(k: K, v: PrinterConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      await updateOrg(org.id, { settings: { ...org.settings, printer: cfg } });
      refresh();
      toast.success("Printer settings saved");
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  // Prints a real receipt with obviously fake amounts, so staff can't confuse a
  // test print with a customer's bill.
  const testPrint = async () => {
    if (!cfg.host.trim()) {
      toast.error("Enter the printer address first");
      return;
    }
    setTesting(true);
    try {
      await printViaEpos(
        cfg.host,
        {
          orgName: org?.name ?? "DishData",
          address: (org?.settings as Record<string, unknown>)?.address as string | null,
          receiptNumber: "TEST",
          orderNumber: "TESTDRUCK",
          createdAt: new Date().toISOString(),
          orderTypeLabel: "Testdruck",
          lines: [{ name: "Testartikel", qty: 1, price: 1.0 }],
          gross: 1, discount: 0, tip: 0, total: 1,
          taxGroups: [{ rate: org?.tax_rate ?? 7, tax: 0.07, net: 0.93, gross: 1 }],
          taxTotal: 0.07,
          netTotal: 0.93,
          paymentLabel: "Testdruck",
          openDrawer: cfg.openDrawer,
          columns: cfg.columns,
        },
        { useHttps: cfg.useHttps },
      );
      toast.success("Test sent to the printer");
    } catch (e) {
      toast.error("Printer not reachable", e instanceof Error ? e.message : "");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Printer className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Receipt Printer</h3>
        <Badge tone={cfg.enabled && cfg.host ? "green" : "neutral"}>
          {cfg.enabled && cfg.host ? "On" : "Off"}
        </Badge>
      </div>

      <div className="space-y-3">
        <Field label="Printer address on your network">
          <Input
            value={cfg.host}
            onChange={(e) => set("host", e.target.value)}
            placeholder="192.168.1.50"
            disabled={!isAdmin}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paper width">
            <Select
              value={String(cfg.columns)}
              onChange={(e) => set("columns", +e.target.value)}
              disabled={!isAdmin}
            >
              <option value="48">80 mm (48 chars)</option>
              <option value="32">58 mm (32 chars)</option>
            </Select>
          </Field>
          <Field label="Connection">
            <Select
              value={cfg.useHttps ? "https" : "http"}
              onChange={(e) => set("useHttps", e.target.value === "https")}
              disabled={!isAdmin}
            >
              <option value="https">HTTPS (required)</option>
              <option value="http">HTTP (local testing)</option>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              disabled={!isAdmin}
              className="h-4 w-4 accent-brand-400"
            />
            Print directly (skip the dialog)
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={cfg.openDrawer}
              onChange={(e) => set("openDrawer", e.target.checked)}
              disabled={!isAdmin}
              className="h-4 w-4 accent-brand-400"
            />
            Open the cash drawer
          </label>
        </div>

        <div className="flex gap-2">
          <Button onClick={save} disabled={!isAdmin || saving}>
            {saving ? "Saving…" : "Save printer"}
          </Button>
          <Button variant="ghost" onClick={testPrint} disabled={testing}>
            {testing ? "Sending…" : "Test print"}
          </Button>
        </div>

        <div className="rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-zinc-500">
          <p className="mb-1.5 font-semibold text-zinc-400">Epson TM-m30 setup</p>
          <p>
            Give the printer a fixed IP on your router, then enable ePOS-Print in its web config.
            Because DishData runs over HTTPS, the browser refuses to talk to a plain-HTTP printer —
            so create a self-signed certificate on the printer, then visit{" "}
            <span className="font-mono text-zinc-400">https://{cfg.host || "printer-ip"}</span> once
            on each till device and accept the warning. After that, printing is instant.
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Geofenced clock-in: pin the restaurant's location so My Day can check staff
 * are actually there before clocking them in. Off (both lat/lng null) is the
 * default for every org — nothing changes until someone sets a pin here.
 * See [[geo]] and [[timeclock]] for how it's enforced.
 */
function ClockInLocationCard({ isAdmin }: { isAdmin: boolean }) {
  const { org, refresh } = useOrg();
  const [lat, setLat] = useState(org?.clockin_lat != null ? String(org.clockin_lat) : "");
  const [lng, setLng] = useState(org?.clockin_lng != null ? String(org.clockin_lng) : "");
  const [radius, setRadius] = useState(String(org?.clockin_radius_m ?? 150));
  const [maxHours, setMaxHours] = useState(String(org?.max_shift_hours ?? 14));
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const enabled = lat.trim() !== "" && lng.trim() !== "";

  const useCurrentLocation = async () => {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
      toast.success("Location captured", `Accurate to ~${Math.round(pos.accuracy)}m — stand at the restaurant when you do this.`);
    } catch (e) {
      toast.error("Couldn't get your location", e instanceof GeoError ? e.message : errorMessage(e));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!org) return;
    setSaving(true);
    try {
      await updateOrg(org.id, {
        clockin_lat: enabled ? +lat : null,
        clockin_lng: enabled ? +lng : null,
        clockin_radius_m: enabled ? Math.max(20, +radius || 150) : null,
        max_shift_hours: Math.max(1, +maxHours || 14),
      });
      refresh();
      toast.success("Clock-in settings saved");
    } catch (e) {
      toast.error("Could not save", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setLat("");
    setLng("");
    if (!org) return;
    setSaving(true);
    try {
      await updateOrg(org.id, { clockin_lat: null, clockin_lng: null, clockin_radius_m: null });
      refresh();
      toast.success("Location check turned off");
    } catch (e) {
      toast.error("Could not save", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Clock-in Location</h3>
        <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        When set, My Day checks staff are within range before clocking them in on their own phone — the
        shared Time Clock tablet is never affected, since it's already at the restaurant.
      </p>

      <div className="space-y-3">
        <Button variant="ghost" disabled={!isAdmin || locating} onClick={useCurrentLocation}>
          <LocateFixed className={cn("h-4 w-4", locating && "animate-pulse")} />
          {locating ? "Locating…" : "Use my current location"}
        </Button>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Latitude">
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="52.5200" disabled={!isAdmin} />
          </Field>
          <Field label="Longitude">
            <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="13.4050" disabled={!isAdmin} />
          </Field>
          <Field label="Radius (m)">
            <Input
              type="number" min="20" step="10"
              value={radius} onChange={(e) => setRadius(e.target.value)}
              disabled={!isAdmin || !enabled}
            />
          </Field>
        </div>

        <Field label="Auto clock-out safety net (max hours on shift)">
          <Input
            type="number" min="1" step="1"
            value={maxHours} onChange={(e) => setMaxHours(e.target.value)}
            disabled={!isAdmin} className="max-w-[10rem]"
          />
        </Field>
        <p className="text-xs text-zinc-500">
          If someone leaves the location while clocked in on My Day, they're clocked out automatically after about
          10 minutes outside it — but only while that phone's browser tab stays open. This cap is the backstop for
          when it doesn't: any shift still open past this many hours is force-closed, whether or not location is set up.
        </p>

        <div className="flex gap-2">
          <Button onClick={save} disabled={!isAdmin || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {enabled && (
            <Button variant="ghost" onClick={clear} disabled={!isAdmin || saving}>
              Turn off location check
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

type SettingsForm = {
  name: string; currency: string; tax: string; target: string;
  staffMaxPct: string; staffCap: string; staffPinAt: string;
};

/**
 * "Friends & family" discount: staff may take up to a set % off for their own
 * guests. The limits set here are enforced in checkout_order, not in the POS —
 * the till is the thing being restrained, so it can't be the thing enforcing
 * the restraint. This card just configures them.
 */
function StaffDiscountCard({
  isAdmin,
  form,
  setForm,
}: {
  isAdmin: boolean;
  form: SettingsForm;
  setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
}) {
  const { org } = useOrg();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  const enabled = +form.staffMaxPct > 0;

  const toggleApprover = async (e: Employee) => {
    try {
      await updateEmployee(org!.id, e.id, { can_approve_discounts: !e.can_approve_discounts });
      invalidate("employees");
    } catch (err) {
      toast.error("Could not update", err instanceof Error ? err.message : "");
    }
  };

  const staff = (employeesQ.data ?? []).filter((e) => e.is_active);

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Percent className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Staff Discount</h3>
        <Badge tone={enabled ? "green" : "neutral"}>{enabled ? "On" : "Off"}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Max %">
          <Input
            type="number" min="0" max="100" step="1"
            value={form.staffMaxPct}
            onChange={(e) => setForm((f) => ({ ...f, staffMaxPct: e.target.value }))}
            disabled={!isAdmin}
            placeholder="0"
          />
        </Field>
        <Field label="Monthly cap">
          <Input
            type="number" min="0" step="10"
            value={form.staffCap}
            onChange={(e) => setForm((f) => ({ ...f, staffCap: e.target.value }))}
            disabled={!isAdmin || !enabled}
            placeholder="No limit"
          />
        </Field>
        <Field label="PIN needed over">
          <Input
            type="number" min="0" step="5"
            value={form.staffPinAt}
            onChange={(e) => setForm((f) => ({ ...f, staffPinAt: e.target.value }))}
            disabled={!isAdmin || !enabled}
            placeholder="Never"
          />
        </Field>
      </div>

      <p className="mt-2 text-xs text-zinc-500">
        {enabled ? (
          <>
            Staff may give up to <strong className="text-zinc-300">{form.staffMaxPct}%</strong> off, choosing any
            amount up to that.{" "}
            {form.staffCap.trim() === ""
              ? "No monthly limit per person."
              : `Each person may give away ${form.staffCap} per month.`}{" "}
            {form.staffPinAt.trim() === ""
              ? "No approval needed."
              : `Anything over ${form.staffPinAt} needs an approver's PIN.`}
          </>
        ) : (
          <>Set a max % above 0 to let staff discount their friends&rsquo; orders. Leave at 0 to keep it off.</>
        )}
      </p>

      {enabled && form.staffPinAt.trim() !== "" && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-xs font-medium text-zinc-400">
            Who can approve — they enter their own PIN at the till
          </p>
          {staff.length === 0 ? (
            <p className="text-xs text-zinc-500">No active employees yet. Add them in Staff.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staff.map((e) => (
                <button
                  key={e.id}
                  onClick={() => isAdmin && toggleApprover(e)}
                  disabled={!isAdmin}
                  title={e.pin ? undefined : "This employee has no PIN set — add one in Staff"}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-default",
                    e.can_approve_discounts
                      ? "border-brand-400/40 bg-brand-400/10 text-brand-300"
                      : "border-line bg-white/[0.02] text-zinc-500",
                  )}
                >
                  {e.name}
                  {e.can_approve_discounts && !e.pin && <span className="ml-1 text-amber-400">no PIN</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function DeliveryZonesCard({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ postcode: "", min_order: "", delivery_fee: "" });
  const [saving, setSaving] = useState(false);

  const load = () => listDeliveryZones(orgId).then(setZones).catch(() => {});

  useEffect(() => { load(); }, [orgId]);

  const save = async () => {
    if (!form.postcode.trim()) return;
    setSaving(true);
    try {
      await upsertDeliveryZone(orgId, {
        postcode: form.postcode.trim().toUpperCase(),
        min_order: parseFloat(form.min_order) || 0,
        delivery_fee: parseFloat(form.delivery_fee) || 0,
      });
      setForm({ postcode: "", min_order: "", delivery_fee: "" });
      setAdding(false);
      await load();
      toast.success("Zone added");
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (zone: DeliveryZone) => {
    try {
      await upsertDeliveryZone(orgId, { id: zone.id, is_active: !zone.is_active });
      await load();
    } catch (e) {
      toast.error("Could not update", e instanceof Error ? e.message : "");
    }
  };

  const remove = async (zone: DeliveryZone) => {
    try {
      await deleteDeliveryZone(orgId, zone.id);
      await load();
      toast.success("Zone removed");
    } catch (e) {
      toast.error("Could not delete", e instanceof Error ? e.message : "");
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-accent-400" />
          <h3 className="font-semibold text-white">Delivery Zones</h3>
          <Badge tone="cyan">{zones.filter((z) => z.is_active).length} active</Badge>
        </div>
        {isAdmin && (
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add postcode
          </Button>
        )}
      </div>
      <p className="mb-4 text-xs text-zinc-500">
        Postcodes you deliver to. Customers enter their postcode at checkout — if it&apos;s not listed, only takeaway is offered.
      </p>

      {adding && (
        <div className="mb-4 grid grid-cols-3 gap-3 rounded-xl border border-brand-400/30 bg-brand-400/5 p-4">
          <Field label="Postcode">
            <Input
              value={form.postcode}
              onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))}
              placeholder="e.g. 10115"
            />
          </Field>
          <Field label="Min order (€)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={form.min_order}
              onChange={(e) => setForm((f) => ({ ...f, min_order: e.target.value }))}
              placeholder="0"
            />
          </Field>
          <Field label="Delivery fee (€)">
            <Input
              type="number"
              min="0"
              step="0.5"
              value={form.delivery_fee}
              onChange={(e) => setForm((f) => ({ ...f, delivery_fee: e.target.value }))}
              placeholder="0"
            />
          </Field>
          <div className="col-span-3 flex gap-2">
            <Button onClick={save} disabled={saving || !form.postcode.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {zones.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-600">No delivery zones yet — add your first postcode above.</p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <span>Postcode</span>
            <span>Min order</span>
            <span>Delivery fee</span>
            <span>Active</span>
            <span />
          </div>
          {zones.map((z) => (
            <div
              key={z.id}
              className={cn(
                "grid grid-cols-[1fr_1fr_1fr_auto_auto] items-center gap-3 px-4 py-3 text-sm",
                !z.is_active && "opacity-40",
              )}
            >
              <span className="font-mono font-semibold text-white">{z.postcode}</span>
              <span className="text-zinc-300">€{z.min_order.toFixed(2)}</span>
              <span className="text-zinc-300">{z.delivery_fee === 0 ? "Free" : `€${z.delivery_fee.toFixed(2)}`}</span>
              {isAdmin ? (
                <button
                  onClick={() => toggle(z)}
                  className={cn(
                    "h-5 w-9 rounded-full transition-colors",
                    z.is_active ? "bg-brand-400" : "bg-zinc-700",
                  )}
                >
                  <span
                    className={cn(
                      "block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow transition-transform",
                      z.is_active && "translate-x-[18px]",
                    )}
                  />
                </button>
              ) : (
                <Badge tone={z.is_active ? "green" : "neutral"}>{z.is_active ? "On" : "Off"}</Badge>
              )}
              {isAdmin ? (
                <button onClick={() => remove(z)} className="text-zinc-600 hover:text-red-400 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Settings() {
  const { org, isAdmin, refresh } = useOrg();
  const { isDemo } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: org?.name ?? "",
    currency: org?.currency ?? "USD",
    tax: String(org?.tax_rate ?? 8.5),
    target: String(org?.target_food_cost_pct ?? 28),
    staffMaxPct: String(org?.staff_discount_max_pct ?? 0),
    staffCap: org?.staff_discount_monthly_cap == null ? "" : String(org.staff_discount_monthly_cap),
    staffPinAt: org?.staff_discount_pin_threshold == null ? "" : String(org.staff_discount_pin_threshold),
  });
  const [accent, setAccent] = useState<string | null>(org?.accent_color ?? null);
  const [enabled, setEnabled] = useState<Set<string>>(() => {
    const s = new Set((org?.settings?.enabled_modules as string[] | undefined) ?? MODULES.map((m) => m.id));
    // Same always-on list useOrg.tsx applies — otherwise a module force-enabled
    // in code shows as an inactive pill here, which is exactly backwards.
    for (const m of ALWAYS_ENABLED_MODULES) s.add(m);
    s.add("team");
    s.add("audit");
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!org) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateOrg(org.id, {
        name: form.name.trim() || org.name,
        currency: form.currency,
        tax_rate: +form.tax || org.tax_rate,
        target_food_cost_pct: +form.target || org.target_food_cost_pct,
        staff_discount_max_pct: Math.max(+form.staffMaxPct || 0, 0),
        // Blank means "no limit", which is a real setting — not the same as 0.
        staff_discount_monthly_cap: form.staffCap.trim() === "" ? null : +form.staffCap,
        staff_discount_pin_threshold: form.staffPinAt.trim() === "" ? null : +form.staffPinAt,
        accent_color: accent,
        settings: { ...org.settings, enabled_modules: [...enabled] },
      });
      refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Settings saved");
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    try {
      const url = await uploadOrgAsset(org.id, file, "logo.webp");
      await updateOrg(org.id, { logo_url: url });
      refresh();
      toast.success("Logo updated");
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "");
    }
  };

  const uploadReceiptLogo = async (file: File) => {
    try {
      const url = await uploadOrgAsset(org.id, file, "receipt-logo.webp");
      await updateOrg(org.id, { receipt_logo_url: url });
      refresh();
      toast.success("Receipt logo updated");
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "");
    }
  };

  const clearReceiptLogo = async () => {
    try {
      await updateOrg(org.id, { receipt_logo_url: null });
      refresh();
      toast.success("Reverted to the main logo on receipts");
    } catch (e) {
      toast.error("Could not update", e instanceof Error ? e.message : "");
    }
  };

  const toggleModule = (id: string) => {
    if ((ALWAYS_ENABLED_MODULES as readonly string[]).includes(id) || id === "team" || id === "audit") return;
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <SectionTitle title="Settings" subtitle="Workspace profile, branding, targets and enabled modules." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">Restaurant Profile</h3>
          <div className="space-y-4">
            <Field label="Restaurant name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={!isAdmin} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Currency">
                <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} disabled={!isAdmin}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tax rate (%)">
                <Input type="number" min="0" step="0.1" value={form.tax} onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value }))} disabled={!isAdmin} />
              </Field>
              <Field label="Food cost target (%)">
                <Input type="number" min="0" step="0.5" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} disabled={!isAdmin} />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              Tax applies at POS checkout. The food-cost target drives dashboard alerts and repricing insights.
            </p>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">Branding</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={() => isAdmin && fileRef.current?.click()}
              className={cn(
                "group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white/[0.02] transition-all",
                isAdmin && "cursor-pointer hover:border-brand-400/50",
              )}
            >
              {org.logo_url ? (
                <img src={org.logo_url} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <Upload className="h-5 w-5 text-zinc-500" />
              )}
            </button>
            <div>
              <p className="text-sm font-medium text-zinc-200">Workspace logo</p>
              <p className="text-xs text-zinc-500">Shown in the sidebar and your public page.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
          </div>

          <div className="mt-4 flex items-center gap-4 border-t border-line pt-4">
            <button
              onClick={() => isAdmin && receiptFileRef.current?.click()}
              className={cn(
                "group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white/[0.02] transition-all",
                isAdmin && "cursor-pointer hover:border-brand-400/50",
              )}
              style={{
                backgroundImage:
                  "repeating-conic-gradient(#111 0% 25%, transparent 0% 50%) 50% / 12px 12px",
              }}
            >
              {org.receipt_logo_url ? (
                <img src={org.receipt_logo_url} alt="receipt logo" className="h-full w-full object-contain" />
              ) : (
                <Upload className="h-5 w-5 text-zinc-500" />
              )}
            </button>
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-200">Receipt logo</p>
              <p className="text-xs text-zinc-500">
                Shown on bills and invoices. A transparent PNG prints cleaner on a thermal roll than a solid
                background — leave unset to use the workspace logo above.
              </p>
              {org.receipt_logo_url && isAdmin && (
                <button
                  onClick={clearReceiptLogo}
                  className="mt-1 cursor-pointer text-xs font-semibold text-zinc-500 underline-offset-2 hover:text-white hover:underline"
                >
                  Revert to workspace logo
                </button>
              )}
            </div>
            <input
              ref={receiptFileRef}
              type="file"
              accept="image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadReceiptLogo(f);
              }}
            />
          </div>

          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-zinc-400">Accent color</p>
            <div className="flex gap-2.5">
              {ACCENTS.map((c) => (
                <button
                  key={c ?? "default"}
                  onClick={() => isAdmin && setAccent(c)}
                  className={cn(
                    "h-8 w-8 cursor-pointer rounded-full transition-all",
                    accent === c ? "ring-2 ring-white ring-offset-2 ring-offset-base" : "opacity-70 hover:opacity-100",
                  )}
                  style={{ background: c ?? "linear-gradient(135deg,#10b981,#22d3ee)" }}
                  title={c ?? "DishData default"}
                />
              ))}
            </div>
          </div>
        </Card>
        <PaymentsCard isAdmin={isAdmin} />
        <StaffDiscountCard isAdmin={isAdmin} form={form} setForm={setForm} />
        <ReceiptPrinterCard isAdmin={isAdmin} />
        <ClockInLocationCard isAdmin={isAdmin} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-accent-400" />
          <h3 className="font-semibold text-white">Enabled Modules</h3>
          <Badge tone="cyan">{enabled.size} active</Badge>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Org-wide switches. Per-user access on top of this is managed in Team &amp; Access.
        </p>
        <div className="space-y-4">
          {MODULE_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{group}</p>
              <div className="flex flex-wrap gap-2">
                {MODULES.filter((m) => m.group === group).map((m) => {
                  const essential = (ALWAYS_ENABLED_MODULES as readonly string[]).includes(m.id) || m.id === "team" || m.id === "audit";
                  const on = enabled.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleModule(m.id)}
                      disabled={essential || !isAdmin}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-default",
                        on
                          ? "border-brand-400/40 bg-brand-400/10 text-brand-300"
                          : "border-line bg-white/[0.02] text-zinc-500",
                      )}
                    >
                      <m.icon className="h-3.5 w-3.5" />
                      {m.name}
                      {essential && <span className="text-[9px] text-zinc-500">(core)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <DeliveryZonesCard orgId={org.id} isAdmin={isAdmin} />

      {isAdmin && (
        <div className="flex items-center justify-between">
          <Button onClick={save} disabled={saving}>
            {saved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : saving ? (
              "Saving…"
            ) : (
              "Save Changes"
            )}
          </Button>
          {isDemo && (
            <Button
              variant="danger"
              onClick={() => {
                clearDemoData();
                window.location.href = "/onboarding";
              }}
            >
              <Trash2 className="h-4 w-4" /> Reset demo data
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
