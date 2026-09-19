import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Search,
  Plus,
  AlertTriangle,
  Timer,
  DollarSign,
  Minus,
  Trash,
  PackagePlus,
  Boxes,
  ScanLine,
  MapPin,
  Wrench,
  Printer,
  Pencil,
  Cpu,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import {
  Card,
  SectionTitle,
  StatCard,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  Table,
  ProgressBar,
  EmptyState,
  PageSkeleton,
  chartTooltipStyle,
} from "@/components/ui";
import { QrCode } from "@/components/QrCode";
import { ScanModal } from "@/components/ScanModal";
import {
  useInventory,
  useInventoryTransactions,
  useVendors,
  useLocations,
  useMaintenance,
  useSupplierPrices,
  useInvalidate,
} from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addInventoryItem, adjustStock, updateInventoryItem } from "@/lib/api/inventory";
import { addLocation, updateLocation, deleteLocation } from "@/lib/api/locations";
import { addMaintenanceLog } from "@/lib/api/assets";
import { reorderLowStock } from "@/lib/api/procurement";
import { buildComparisons } from "@/lib/api/pricing";
import { bookValue, labelCode, locationLabel, printLabel } from "@/lib/labels";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type {
  InventoryItem,
  StorageLocation,
  WasteReason,
  ItemType,
  AssetStatus,
  MaintenanceKind,
} from "@/lib/api/database.types";

type Status = "Low" | "Expiring" | "Healthy";
type Tab = "items" | "equipment" | "locations";

const FOOD_CATEGORIES = ["Produce", "Meat", "Seafood", "Dairy", "Dry Goods", "Beverage"];
const SUPPLY_CATEGORIES = ["Packaging", "Supplies", "Cleaning", "Disposables", "Stationery"];
const EQUIPMENT_CATEGORIES = ["Equipment", "Machines", "Smallwares", "IT & POS"];
const UNITS = ["kg", "L", "btl", "pc", "case", "roll", "box"];
const ASSET_STATUSES: AssetStatus[] = ["in_service", "maintenance", "retired"];

function daysUntil(dateStr: string | null): number {
  if (!dateStr) return 999;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

const isEquipment = (i: InventoryItem) => i.item_type === "equipment";

function itemStatus(i: InventoryItem): Status {
  if (i.stock < i.par_level * 0.5) return "Low";
  if (daysUntil(i.expires_at) <= 2) return "Expiring";
  return "Healthy";
}

const statusTone: Record<Status, "rose" | "amber" | "green"> = { Low: "rose", Expiring: "amber", Healthy: "green" };
const assetTone: Record<AssetStatus, "green" | "amber" | "rose"> = {
  in_service: "green",
  maintenance: "amber",
  retired: "rose",
};
const typeTone: Record<ItemType, "cyan" | "violet" | "neutral"> = {
  ingredient: "cyan",
  supply: "violet",
  equipment: "neutral",
};

// ---------------------------------------------------------------------------
// Add / edit item
// ---------------------------------------------------------------------------
function AddItemForm({ defaultType, onDone }: { defaultType: ItemType; onDone: () => void }) {
  const { org } = useOrg();
  const vendorsQ = useVendors();
  const locationsQ = useLocations();
  const invalidate = useInvalidate();
  const [type, setType] = useState<ItemType>(defaultType);
  const [form, setForm] = useState({
    name: "",
    category: defaultType === "equipment" ? "Equipment" : defaultType === "supply" ? "Packaging" : "Produce",
    stock: "",
    unit: "kg",
    parLevel: "",
    unitCost: "",
    vendorId: "",
    sku: "",
    locationId: "",
    serial: "",
    purchaseDate: "",
    purchaseCost: "",
    depMonths: "",
    assetStatus: "in_service" as AssetStatus,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const categories =
    type === "equipment" ? EQUIPMENT_CATEGORIES : type === "supply" ? SUPPLY_CATEGORIES : FOOD_CATEGORIES;
  const equip = type === "equipment";
  const valid = form.name.trim() && (equip ? +form.purchaseCost >= 0 : +form.unitCost > 0);

  const changeType = (t: ItemType) => {
    setType(t);
    setForm((f) => ({
      ...f,
      category: t === "equipment" ? "Equipment" : t === "supply" ? "Packaging" : "Produce",
      unit: t === "equipment" ? "pc" : f.unit,
    }));
  };

  const add = useMutation({
    mutationFn: () =>
      addInventoryItem(org!.id, {
        name: form.name.trim(),
        category: form.category,
        item_type: type,
        stock: equip ? 1 : +form.stock || 0,
        unit: equip ? "pc" : form.unit,
        par_level: equip ? 0 : +form.parLevel || 10,
        unit_cost: equip ? 0 : +form.unitCost,
        expires_at: null,
        vendor_id: form.vendorId || null,
        sku: form.sku.trim() || null,
        location_id: form.locationId || null,
        serial_number: equip ? form.serial.trim() || null : null,
        purchase_date: equip ? form.purchaseDate || null : null,
        purchase_cost: equip ? +form.purchaseCost || null : null,
        depreciation_months: equip ? +form.depMonths || null : null,
        asset_status: equip ? form.assetStatus : null,
        grams_per_unit: null,
      }),
    onSuccess: () => {
      invalidate("inventory");
      toast.success("Item added", form.name.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not add item", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Item type">
        <div className="grid grid-cols-3 gap-1.5">
          {(["ingredient", "supply", "equipment"] as ItemType[]).map((t) => (
            <button
              key={t}
              onClick={() => changeType(t)}
              className={cn(
                "cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition-all",
                type === t
                  ? "border-brand-400/50 bg-brand-500/10 text-white"
                  : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Item name">
        <Input value={form.name} onChange={set("name")} placeholder={equip ? "e.g. Espresso Machine" : "e.g. Olive oil"} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={form.category} onChange={set("category")}>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Location / shelf">
          <Select value={form.locationId} onChange={set("locationId")}>
            <option value="">Unassigned</option>
            {(locationsQ.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({locationLabel(l)})
              </option>
            ))}
          </Select>
        </Field>

        {!equip && (
          <>
            <Field label="Vendor">
              <Select value={form.vendorId} onChange={set("vendorId")}>
                <option value="">Unassigned</option>
                {(vendorsQ.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unit">
              <Select value={form.unit} onChange={set("unit")}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </Field>
            <Field label="Current stock">
              <Input type="number" min="0" value={form.stock} onChange={set("stock")} placeholder="10" />
            </Field>
            <Field label="Par level">
              <Input type="number" min="0" value={form.parLevel} onChange={set("parLevel")} placeholder="15" />
            </Field>
            <Field label="Unit cost">
              <Input type="number" min="0" step="0.1" value={form.unitCost} onChange={set("unitCost")} placeholder="8.50" />
            </Field>
          </>
        )}

        {equip && (
          <>
            <Field label="Serial number">
              <Input value={form.serial} onChange={set("serial")} placeholder="LM-2024-8841" />
            </Field>
            <Field label="Purchase date">
              <Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />
            </Field>
            <Field label="Purchase cost">
              <Input type="number" min="0" step="1" value={form.purchaseCost} onChange={set("purchaseCost")} placeholder="6800" />
            </Field>
            <Field label="Depreciation (months)">
              <Input type="number" min="0" value={form.depMonths} onChange={set("depMonths")} placeholder="60" />
            </Field>
            <Field label="Status">
              <Select value={form.assetStatus} onChange={set("assetStatus")}>
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Field label="Label code / SKU (optional)">
          <Input value={form.sku} onChange={set("sku")} placeholder="auto from ID if blank" />
        </Field>
      </div>

      <Button className="w-full" disabled={!valid || add.isPending} onClick={() => add.mutate()}>
        {add.isPending ? "Adding…" : "Add Item"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waste (consumables only)
// ---------------------------------------------------------------------------
function WasteForm({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const fmt = useFmt();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<WasteReason>("spoiled");

  const log = useMutation({
    mutationFn: () => adjustStock(org!.id, item, -Math.abs(+qty), "waste", reason),
    onSuccess: () => {
      invalidate("inventory", "inventory_tx");
      toast.success("Waste logged", `${qty} ${item.unit} of ${item.name} (${reason})`);
      onDone();
    },
    onError: (e) => toast.error("Could not log waste", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">
        {item.name} — {item.stock} {item.unit} on hand · {fmt(item.unit_cost, 2)}/{item.unit}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Quantity (${item.unit})`}>
          <Input type="number" min="0" step="0.1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value as WasteReason)}>
            {(["spoiled", "burnt", "returned", "overprep", "other"] as WasteReason[]).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
      </div>
      {+qty > 0 && (
        <p className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs text-rose-soft">
          Writes off {fmt(+qty * item.unit_cost, 2)} of stock value.
        </p>
      )}
      <Button className="w-full" variant="danger" disabled={!(+qty > 0) || log.isPending} onClick={() => log.mutate()}>
        Log Waste
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Maintenance log entry
// ---------------------------------------------------------------------------
function MaintenanceForm({ item, onDone }: { item: InventoryItem; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    performed_at: new Date().toISOString().slice(0, 10),
    kind: "service" as MaintenanceKind,
    cost: "",
    note: "",
    next_due_at: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = useMutation({
    mutationFn: () =>
      addMaintenanceLog(org!.id, {
        item_id: item.id,
        performed_at: form.performed_at,
        kind: form.kind,
        cost: +form.cost || 0,
        note: form.note.trim() || null,
        next_due_at: form.next_due_at || null,
      }),
    onSuccess: () => {
      invalidate("maintenance");
      toast.success("Maintenance logged", item.name);
      onDone();
    },
    onError: (e) => toast.error("Could not log maintenance", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={form.performed_at} onChange={set("performed_at")} />
        </Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={set("kind")}>
            {(["service", "repair", "inspection"] as MaintenanceKind[]).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
        </Field>
        <Field label="Cost">
          <Input type="number" min="0" step="1" value={form.cost} onChange={set("cost")} placeholder="140" />
        </Field>
        <Field label="Next due (optional)">
          <Input type="date" value={form.next_due_at} onChange={set("next_due_at")} />
        </Field>
      </div>
      <Field label="Note">
        <Input value={form.note} onChange={set("note")} placeholder="Descale + gasket replaced" />
      </Field>
      <Button className="w-full" disabled={add.isPending} onClick={() => add.mutate()}>
        {add.isPending ? "Saving…" : "Log Maintenance"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item detail drawer (QR label, location, depreciation, maintenance)
// ---------------------------------------------------------------------------
function ItemDetail({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { org } = useOrg();
  const fmt = useFmt();
  const locationsQ = useLocations();
  const maintenanceQ = useMaintenance();
  const pricesQ = useSupplierPrices();
  const invalidate = useInvalidate();
  const [addingMaint, setAddingMaint] = useState(false);

  const loc = (locationsQ.data ?? []).find((l) => l.id === item.location_id);
  const locText = locationLabel(loc);
  const equip = isEquipment(item);
  const priceCmp = useMemo(() => {
    const rows = (pricesQ.data ?? []).filter((p) => p.inventory_item_id === item.id);
    return rows.length ? buildComparisons(rows)[0] : null;
  }, [pricesQ.data, item.id]);
  const book = bookValue(item);
  const logs = (maintenanceQ.data ?? []).filter((m) => m.item_id === item.id);

  const setStatus = useMutation({
    mutationFn: (status: AssetStatus) => updateInventoryItem(org!.id, item.id, { asset_status: status }),
    onSuccess: () => {
      invalidate("inventory");
      toast.success("Status updated", item.name);
    },
    onError: (e) => toast.error("Could not update", e instanceof Error ? e.message : ""),
  });

  const setItemLocation = useMutation({
    mutationFn: (locationId: string) =>
      updateInventoryItem(org!.id, item.id, { location_id: locationId || null }),
    onSuccess: () => {
      invalidate("inventory");
      toast.success("Location updated", item.name);
    },
    onError: (e) => toast.error("Could not update", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-5">
      <div className="flex gap-4">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <div className="rounded-xl bg-white p-2">
            <QrCode value={labelCode(item)} size={104} />
          </div>
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => printLabel(item, locText)}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={typeTone[item.item_type]}>{item.item_type}</Badge>
            <span className="text-xs text-zinc-500">{item.category}</span>
          </div>
          <p className="font-mono text-xs text-zinc-400">{labelCode(item)}</p>
          <p className="flex items-center gap-1.5 text-sm text-zinc-300">
            <MapPin className="h-3.5 w-3.5 text-brand-300" /> {locText}
          </p>
          <Field label="Move to location">
            <Select value={item.location_id ?? ""} onChange={(e) => setItemLocation.mutate(e.target.value)}>
              <option value="">Unassigned</option>
              {(locationsQ.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({locationLabel(l)})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {equip ? (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-white/[0.02] p-4 text-sm">
          <div>
            <p className="text-xs text-zinc-500">Serial</p>
            <p className="font-mono text-zinc-200">{item.serial_number ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Status</p>
            <Select
              value={item.asset_status ?? "in_service"}
              onChange={(e) => setStatus.mutate(e.target.value as AssetStatus)}
              className="mt-1 py-1.5 text-xs"
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Purchase cost</p>
            <p className="text-zinc-200">{item.purchase_cost != null ? fmt(item.purchase_cost) : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Book value (depreciated)</p>
            <p className="font-semibold text-brand-300">{book != null ? fmt(book) : "—"}</p>
          </div>
          {item.purchase_date && (
            <div>
              <p className="text-xs text-zinc-500">Purchased</p>
              <p className="text-zinc-200">{item.purchase_date}</p>
            </div>
          )}
          {item.depreciation_months != null && (
            <div>
              <p className="text-xs text-zinc-500">Useful life</p>
              <p className="text-zinc-200">{item.depreciation_months} months</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-white/[0.02] p-4 text-sm">
          <div>
            <p className="text-xs text-zinc-500">On hand</p>
            <p className="text-zinc-200">{+item.stock.toFixed(2)} {item.unit}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Par level</p>
            <p className="text-zinc-200">{item.par_level} {item.unit}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Value</p>
            <p className="text-zinc-200">{fmt(item.stock * item.unit_cost)}</p>
          </div>
        </div>
      )}

      {!equip && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-white">
            <DollarSign className="h-4 w-4 text-brand-300" /> Vendor prices
          </h3>
          {!priceCmp ? (
            <p className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm text-zinc-500">
              No price history yet. Prices are captured when a PO is delivered — or record one in Procurement → Price Intelligence.
            </p>
          ) : (
            <div className="space-y-1.5">
              {priceCmp.vendors.map((v) => {
                const isBest =
                  v.vendor_id === priceCmp.best?.vendor_id && v.vendor_name === priceCmp.best?.vendor_name;
                return (
                  <div
                    key={`${v.vendor_id}-${v.vendor_name}`}
                    className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-zinc-200">
                      {v.vendor_name}
                      {isBest && <Badge tone="green">best</Badge>}
                    </span>
                    <span className="font-medium text-zinc-200">
                      {fmt(v.unitPrice, 2)}
                      <span className="text-zinc-500">/{item.unit}</span>
                    </span>
                  </div>
                );
              })}
              {priceCmp.changePct !== null && priceCmp.latest && (
                <p className="px-1 text-xs text-zinc-500">
                  Last paid {fmt(priceCmp.latest.unitPrice, 2)}/{item.unit} (
                  <span className={priceCmp.changePct > 0 ? "text-rose-soft" : "text-brand-300"}>
                    {priceCmp.changePct > 0 ? "+" : ""}
                    {priceCmp.changePct.toFixed(1)}%
                  </span>{" "}
                  vs previous).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {equip && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-semibold text-white">
              <Wrench className="h-4 w-4 text-brand-300" /> Maintenance log
            </h3>
            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setAddingMaint(true)}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
          {logs.length === 0 ? (
            <p className="rounded-xl border border-line bg-white/[0.02] p-3 text-sm text-zinc-500">
              No maintenance recorded yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-zinc-200 capitalize">
                      {m.kind} · <span className="text-zinc-400">{m.performed_at}</span>
                    </p>
                    {m.note && <p className="truncate text-xs text-zinc-500">{m.note}</p>}
                    {m.next_due_at && <p className="text-xs text-amber-soft">Next due {m.next_due_at}</p>}
                  </div>
                  <span className="shrink-0 font-medium text-zinc-300">{fmt(m.cost)}</span>
                </div>
              ))}
            </div>
          )}
          <Modal open={addingMaint} onClose={() => setAddingMaint(false)} title={`Log maintenance — ${item.name}`}>
            <MaintenanceForm item={item} onDone={() => setAddingMaint(false)} />
          </Modal>
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Location add / edit
// ---------------------------------------------------------------------------
function LocationForm({ existing, onDone }: { existing?: StorageLocation; onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    area: existing?.area ?? "",
    shelf: existing?.shelf ?? "",
    notes: existing?.notes ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: form.name.trim(), area: form.area.trim(), shelf: form.shelf.trim(), notes: form.notes.trim() || null };
      return existing ? updateLocation(org!.id, existing.id, payload) : addLocation(org!.id, payload);
    },
    onSuccess: () => {
      invalidate("locations");
      toast.success(existing ? "Location updated" : "Location added", form.name.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not save location", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input value={form.name} onChange={set("name")} placeholder="e.g. Walk-in F1" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area">
          <Input value={form.area} onChange={set("area")} placeholder="Dry Store" />
        </Field>
        <Field label="Shelf">
          <Input value={form.shelf} onChange={set("shelf")} placeholder="B3" />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Input value={form.notes} onChange={set("notes")} placeholder="Ambient shelving" />
      </Field>
      <Button className="w-full" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : existing ? "Save changes" : "Add Location"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Inventory() {
  const { org } = useOrg();
  const fmt = useFmt();
  const inventoryQ = useInventory();
  const txQ = useInventoryTransactions();
  const vendorsQ = useVendors();
  const locationsQ = useLocations();
  const invalidate = useInvalidate();

  const [tab, setTab] = useState<Tab>("items");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | Status>("All");
  const [locationFilter, setLocationFilter] = useState("All");
  const [adding, setAdding] = useState(false);
  const [wasteItem, setWasteItem] = useState<InventoryItem | null>(null);
  const [detailItem, setDetailItem] = useState<InventoryItem | null>(null);
  const [scanning, setScanning] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);
  const [editLocation, setEditLocation] = useState<StorageLocation | null>(null);

  const inventory = inventoryQ.data ?? [];
  const transactions = txQ.data ?? [];
  const locations = locationsQ.data ?? [];

  const consumables = useMemo(() => inventory.filter((i) => !isEquipment(i)), [inventory]);
  const equipment = useMemo(() => inventory.filter(isEquipment), [inventory]);

  const totalValue = consumables.reduce((s, i) => s + i.stock * i.unit_cost, 0);
  const lowItems = consumables.filter((i) => itemStatus(i) === "Low");
  const expiringCount = consumables.filter((i) => itemStatus(i) === "Expiring").length;
  const assetsValue = equipment.reduce((s, i) => s + (bookValue(i) ?? 0), 0);

  const locName = (id: string | null) => locationLabel(locations.find((l) => l.id === id));

  const filteredItems = useMemo(
    () =>
      consumables.filter(
        (i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) &&
          (statusFilter === "All" || itemStatus(i) === statusFilter) &&
          (locationFilter === "All" || i.location_id === locationFilter),
      ),
    [consumables, query, statusFilter, locationFilter],
  );

  const filteredEquipment = useMemo(
    () =>
      equipment.filter(
        (i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) &&
          (locationFilter === "All" || i.location_id === locationFilter),
      ),
    [equipment, query, locationFilter],
  );

  const wasteByCategory = useMemo(() => {
    const map = new Map<string, number>();
    const cutoff = Date.now() - 14 * 86400000;
    for (const tx of transactions) {
      if (tx.reason !== "waste" || new Date(tx.created_at).getTime() < cutoff) continue;
      const item = inventory.find((i) => i.id === tx.item_id);
      const value = Math.abs(tx.delta) * (item?.unit_cost ?? 0);
      const cat = item?.category ?? "Other";
      map.set(cat, (map.get(cat) ?? 0) + value);
    }
    return [...map.entries()]
      .map(([category, value]) => ({ category, value: +value.toFixed(0) }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, inventory]);

  const reorder = useMutation({
    mutationFn: () => reorderLowStock(org!.id, lowItems, vendorsQ.data ?? []),
    onSuccess: (count) => {
      invalidate("purchase_orders");
      toast.success(`${count} draft PO${count > 1 ? "s" : ""} created`, "Review them in Procurement");
    },
    onError: (e) => toast.error("Reorder failed", e instanceof Error ? e.message : ""),
  });

  const quickAdjust = async (item: InventoryItem, delta: number) => {
    try {
      await adjustStock(org!.id, item, delta, "adjustment");
      invalidate("inventory", "inventory_tx");
    } catch (e) {
      toast.error("Adjustment failed", e instanceof Error ? e.message : "");
    }
  };

  const removeLocation = async (loc: StorageLocation) => {
    const count = inventory.filter((i) => i.location_id === loc.id).length;
    if (count > 0) {
      toast.error("Location in use", `${count} item${count > 1 ? "s" : ""} still here — move them first.`);
      return;
    }
    if (!confirm(`Delete location "${loc.name}"?`)) return;
    try {
      await deleteLocation(org!.id, loc.id);
      invalidate("locations");
      toast.success("Location deleted", loc.name);
    } catch (e) {
      toast.error("Could not delete", e instanceof Error ? e.message : "");
    }
  };

  const handleDetected = (code: string) => {
    const lc = code.toLowerCase();
    const found = inventory.find((i) => i.id === code || i.sku?.toLowerCase() === lc);
    setScanning(false);
    if (found) {
      setTab(isEquipment(found) ? "equipment" : "items");
      setDetailItem(found);
    } else {
      toast.error("No item found", code);
    }
  };

  if (inventoryQ.isLoading) return <PageSkeleton />;

  const defaultType: ItemType = tab === "equipment" ? "equipment" : "ingredient";

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Inventory"
        subtitle="Stock, company assets & supplies — tagged, located and scannable."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setScanning(true)}>
              <ScanLine className="h-4 w-4" /> Scan
            </Button>
            {tab === "items" && lowItems.length > 0 && (
              <Button variant="ghost" onClick={() => reorder.mutate()} disabled={reorder.isPending}>
                <PackagePlus className="h-4 w-4" /> Reorder {lowItems.length} low
              </Button>
            )}
            {tab === "locations" ? (
              <Button onClick={() => setAddingLocation(true)}>
                <Plus className="h-4 w-4" /> Add Location
              </Button>
            ) : (
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add Item
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Stock Value" value={fmt(totalValue)} hint="consumables on hand" icon={DollarSign} />
        <StatCard title="Low Stock" value={String(lowItems.length)} hint="below 50% of par" icon={AlertTriangle} />
        <StatCard title="Expiring Soon" value={String(expiringCount)} hint="within 48 hours" icon={Timer} />
        <StatCard title="Assets Value" value={fmt(assetsValue)} hint={`${equipment.length} equipment, depreciated`} icon={Cpu} />
      </div>

      <div className="flex gap-1.5">
        {(
          [
            ["items", "Items", consumables.length],
            ["equipment", "Equipment", equipment.length],
            ["locations", "Locations", locations.length],
          ] as [Tab, string, number][]
        ).map(([t, label, count]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition-all",
              tab === t
                ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
            )}
          >
            {label} <span className="opacity-70">{count}</span>
          </button>
        ))}
      </div>

      {tab === "locations" ? (
        <LocationsTab
          locations={locations}
          inventory={inventory}
          onAdd={() => setAddingLocation(true)}
          onEdit={setEditLocation}
          onDelete={removeLocation}
          onOpenItem={setDetailItem}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <Card>
            <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input placeholder="Search items…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
              </div>
              <Select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="sm:w-44">
                <option value="All">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
              {tab === "items" && (
                <div className="flex gap-1.5">
                  {(["All", "Low", "Expiring", "Healthy"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                        statusFilter === s
                          ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                          : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {tab === "items" ? (
              consumables.length === 0 ? (
                <EmptyState
                  icon={Boxes}
                  title="No inventory yet"
                  hint="Add your first items to start tracking stock, costs and waste."
                  action={
                    <Button onClick={() => setAdding(true)}>
                      <Plus className="h-4 w-4" /> Add Item
                    </Button>
                  }
                />
              ) : (
                <Table headers={["Item", "Stock", "Location", "Status", "Value", ""]}>
                  {filteredItems.map((i) => {
                    const status = itemStatus(i);
                    return (
                      <tr key={i.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDetailItem(i)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-white">{i.name}</p>
                            <Badge tone={typeTone[i.item_type]}>{i.item_type}</Badge>
                          </div>
                          <p className="text-xs text-zinc-500">{i.category}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-200">
                            {+i.stock.toFixed(2)} {i.unit}
                          </p>
                          <ProgressBar
                            value={(i.stock / Math.max(1, i.par_level)) * 100}
                            tone={status === "Low" ? "rose" : status === "Expiring" ? "amber" : "green"}
                            className="mt-1.5 w-20"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">{locName(i.location_id)}</td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone[status]}>{status}</Badge>
                        </td>
                        <td className="px-4 py-3 font-medium text-zinc-200">{fmt(i.stock * i.unit_cost)}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button onClick={() => quickAdjust(i, -1)} className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" title="Adjust −1">
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => quickAdjust(i, 1)} className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" title="Adjust +1">
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => setWasteItem(i)} className="cursor-pointer rounded-lg bg-rose-soft/10 p-1.5 text-rose-soft hover:bg-rose-soft/20" title="Log waste">
                              <Trash className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              )
            ) : equipment.length === 0 ? (
              <EmptyState
                icon={Cpu}
                title="No equipment yet"
                hint="Add machines and durable assets with serials, purchase cost and maintenance history."
                action={
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="h-4 w-4" /> Add Item
                  </Button>
                }
              />
            ) : (
              <Table headers={["Asset", "Serial", "Location", "Status", "Book value", ""]}>
                {filteredEquipment.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDetailItem(i)}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{i.name}</p>
                      <p className="text-xs text-zinc-500">{i.category}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{i.serial_number ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{locName(i.location_id)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={assetTone[i.asset_status ?? "in_service"]}>
                        {(i.asset_status ?? "in_service").replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium text-zinc-200">{fmt(bookValue(i) ?? 0)}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDetailItem(i)}
                        className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
                        title="View"
                      >
                        <Wrench className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}

            {tab === "items" && consumables.length > 0 && filteredItems.length === 0 && (
              <p className="p-8 text-center text-sm text-zinc-500">No items match your filters.</p>
            )}
            {tab === "equipment" && equipment.length > 0 && filteredEquipment.length === 0 && (
              <p className="p-8 text-center text-sm text-zinc-500">No equipment matches your filters.</p>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="font-semibold text-white">Waste by Category</h3>
              <p className="text-xs text-zinc-500">Last 14 days, by value</p>
              {wasteByCategory.length === 0 ? (
                <EmptyState title="No waste logged" hint="Use the red bin button on any item to log spoilage." className="py-8" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={wasteByCategory} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262a38" horizontal={false} />
                    <XAxis type="number" stroke="#71717a" fontSize={11} tickFormatter={(v: number) => fmt(v)} />
                    <YAxis type="category" dataKey="category" stroke="#71717a" fontSize={11} width={70} tickLine={false} />
                    <Tooltip {...chartTooltipStyle} formatter={(v) => [fmt(Number(v)), "Value"]} />
                    <Bar dataKey="value" fill="#fb7185" radius={[0, 6, 6, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-white">Recent Movements</h3>
              <p className="mb-2 text-xs text-zinc-500">Sales, purchases, waste & adjustments</p>
              {transactions.length === 0 ? (
                <EmptyState title="No movements yet" hint="POS sales will appear here as stock depletes." className="py-8" />
              ) : (
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {transactions.slice(0, 30).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-white/[0.02]">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-200">{tx.item_name}</p>
                        <p className="text-zinc-500 capitalize">
                          {tx.reason}
                          {tx.waste_reason ? ` · ${tx.waste_reason}` : ""}
                        </p>
                      </div>
                      <span className={cn("shrink-0 font-semibold", tx.delta < 0 ? "text-rose-soft" : "text-brand-300")}>
                        {tx.delta > 0 ? "+" : ""}
                        {+tx.delta.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add Inventory Item" wide>
        <AddItemForm defaultType={defaultType} onDone={() => setAdding(false)} />
      </Modal>
      <Modal open={!!wasteItem} onClose={() => setWasteItem(null)} title={`Log waste — ${wasteItem?.name ?? ""}`}>
        {wasteItem && <WasteForm item={wasteItem} onDone={() => setWasteItem(null)} />}
      </Modal>
      <Modal open={!!detailItem} onClose={() => setDetailItem(null)} title={detailItem?.name ?? ""} wide>
        {detailItem && <ItemDetail item={detailItem} onClose={() => setDetailItem(null)} />}
      </Modal>
      <Modal open={addingLocation} onClose={() => setAddingLocation(false)} title="Add Storage Location">
        <LocationForm onDone={() => setAddingLocation(false)} />
      </Modal>
      <Modal open={!!editLocation} onClose={() => setEditLocation(null)} title={`Edit — ${editLocation?.name ?? ""}`}>
        {editLocation && <LocationForm existing={editLocation} onDone={() => setEditLocation(null)} />}
      </Modal>
      <ScanModal open={scanning} onClose={() => setScanning(false)} onDetected={handleDetected} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locations tab
// ---------------------------------------------------------------------------
function LocationsTab({
  locations,
  inventory,
  onAdd,
  onEdit,
  onDelete,
  onOpenItem,
}: {
  locations: StorageLocation[];
  inventory: InventoryItem[];
  onAdd: () => void;
  onEdit: (l: StorageLocation) => void;
  onDelete: (l: StorageLocation) => void;
  onOpenItem: (i: InventoryItem) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (locations.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No storage locations yet"
        hint="Define your shelves, fridges and zones so you can find any item fast."
        action={
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add Location
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {locations.map((l) => {
        const items = inventory.filter((i) => i.location_id === l.id);
        const open = expanded === l.id;
        return (
          <Card key={l.id} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-brand-300" />
                  <h3 className="font-semibold text-white">{l.name}</h3>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{locationLabel(l)}</p>
                {l.notes && <p className="mt-1 text-xs text-zinc-500">{l.notes}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => onEdit(l)} className="cursor-pointer rounded-lg bg-white/5 p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" title="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onDelete(l)} className="cursor-pointer rounded-lg bg-rose-soft/10 p-1.5 text-rose-soft hover:bg-rose-soft/20" title="Delete">
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <button
              onClick={() => setExpanded(open ? null : l.id)}
              className="mt-3 w-full cursor-pointer rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-left text-xs font-medium text-zinc-300 hover:bg-white/[0.04]"
            >
              {items.length} item{items.length !== 1 ? "s" : ""} stored here {open ? "▲" : "▼"}
            </button>
            {open && items.length > 0 && (
              <div className="mt-2 space-y-1">
                {items.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => onOpenItem(i)}
                    className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-white/[0.03]"
                  >
                    <span className="text-zinc-200">{i.name}</span>
                    <Badge tone={typeTone[i.item_type]}>{i.item_type}</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
