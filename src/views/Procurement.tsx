import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Star, Truck, ArrowRight, CircleDollarSign, ClipboardList, Trash2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
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
  EmptyState,
  PageSkeleton,
  chartTooltipStyle,
} from "@/components/ui";
import { useVendors, usePurchaseOrders, useInventory, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { createPurchaseOrder, advancePurchaseOrder, addVendor } from "@/lib/api/procurement";
import PriceIntelligence from "@/views/PriceIntelligence";
import { toast } from "@/lib/toast";
import { uid } from "@/lib/utils";
import type { PurchaseOrder, PoStatus } from "@/lib/api/database.types";

const statusTone: Record<PoStatus, "neutral" | "cyan" | "violet" | "green" | "amber"> = {
  draft: "neutral",
  sent: "cyan",
  confirmed: "violet",
  delivered: "green",
  reconciled: "amber",
};

interface PoItemRow {
  key: string;
  inventory_item_id: string;
  qty: string;
}

function CreatePoForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const fmt = useFmt();
  const vendorsQ = useVendors();
  const inventoryQ = useInventory();
  const invalidate = useInvalidate();
  const vendors = vendorsQ.data ?? [];
  const inventory = inventoryQ.data ?? [];

  const [vendorId, setVendorId] = useState("");
  const [expected, setExpected] = useState("Tomorrow");
  const [rows, setRows] = useState<PoItemRow[]>([{ key: uid(), inventory_item_id: "", qty: "" }]);

  const itemRows = rows
    .map((r) => ({ ...r, item: inventory.find((i) => i.id === r.inventory_item_id) }))
    .filter((r) => r.item && +r.qty > 0);
  const total = itemRows.reduce((s, r) => s + +r.qty * r.item!.unit_cost, 0);

  const create = useMutation({
    mutationFn: () => {
      const vendor = vendors.find((v) => v.id === vendorId);
      return createPurchaseOrder(org!.id, {
        vendor_id: vendor?.id ?? null,
        vendor_name: vendor?.name ?? "Unassigned",
        expected_at: expected,
        items: itemRows.map((r) => ({
          inventory_item_id: r.item!.id,
          name: r.item!.name,
          qty: +r.qty,
          unit_cost: r.item!.unit_cost,
        })),
      });
    },
    onSuccess: (poNumber) => {
      invalidate("purchase_orders");
      toast.success(`${poNumber} created`, "Draft — advance it when sent to the vendor");
      onDone();
    },
    onError: (e) => toast.error("Could not create PO", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Choose vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expected delivery">
          <Select value={expected} onChange={(e) => setExpected(e.target.value)}>
            {["Today", "Tomorrow", "In 2 days", "This week"].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">Line items — stock in automatically on delivery</p>
        <div className="space-y-2">
          {rows.map((r) => {
            const item = inventory.find((i) => i.id === r.inventory_item_id);
            return (
              <div key={r.key} className="flex gap-2">
                <Select
                  value={r.inventory_item_id}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, inventory_item_id: e.target.value } : x)))
                  }
                  className="flex-1"
                >
                  <option value="">Select item…</option>
                  {inventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({fmt(i.unit_cost, 2)}/{i.unit})
                    </option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder={item ? `Qty (${item.unit})` : "Qty"}
                  className="w-28"
                  value={r.qty}
                  onChange={(e) => setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))}
                />
                <button
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  disabled={rows.length === 1}
                  className="cursor-pointer rounded-lg p-2 text-zinc-500 hover:text-rose-soft disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setRows((prev) => [...prev, { key: uid(), inventory_item_id: "", qty: "" }])}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-400 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
        <span className="text-zinc-400">Order total</span>
        <span className="font-semibold text-white">{fmt(total, 2)}</span>
      </div>
      <Button className="w-full" disabled={itemRows.length === 0 || create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? "Creating…" : "Create Purchase Order"}
      </Button>
    </div>
  );
}

function AddVendorForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Produce");
  const [email, setEmail] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addVendor(org!.id, {
        name: name.trim(),
        category,
        contact_email: email.trim() || null,
        contact_phone: null,
        rating: 4.5,
        on_time_pct: 95,
        monthly_spend: 0,
        price_index: 100,
      }),
    onSuccess: () => {
      invalidate("vendors");
      toast.success("Vendor added", name.trim());
      onDone();
    },
    onError: (e) => toast.error("Could not add vendor", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Vendor name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbor Fish Co" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {["Produce", "Meat", "Seafood", "Dairy", "Dry Goods", "Beverage", "General"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Contact email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@vendor.com" />
        </Field>
      </div>
      <Button className="w-full" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
        Add Vendor
      </Button>
    </div>
  );
}

export default function Procurement() {
  const { org } = useOrg();
  const fmt = useFmt();
  const vendorsQ = useVendors();
  const posQ = usePurchaseOrders();
  const invalidate = useInvalidate();
  const [creating, setCreating] = useState(false);
  const [addingVendor, setAddingVendor] = useState(false);

  const vendors = vendorsQ.data ?? [];
  const purchaseOrders = posQ.data ?? [];

  const openValue = purchaseOrders.filter((po) => po.status !== "reconciled").reduce((s, po) => s + po.total, 0);
  const monthlySpend = vendors.reduce((s, v) => s + v.monthly_spend, 0);
  const avgOnTime = vendors.length ? vendors.reduce((s, v) => s + v.on_time_pct, 0) / vendors.length : 0;

  const advance = async (po: PurchaseOrder) => {
    try {
      const next = await advancePurchaseOrder(org!.id, po);
      invalidate("purchase_orders", "inventory", "inventory_tx", "supplier_prices");
      toast.success(`${po.po_number} → ${next}`, next === "delivered" ? "Stock levels updated" : undefined);
    } catch (e) {
      toast.error("Could not advance PO", e instanceof Error ? e.message : "");
    }
  };

  if (vendorsQ.isLoading || posQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Procurement"
        subtitle="Purchase orders that stock in on delivery, plus vendor benchmarking."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setAddingVendor(true)}>
              <Plus className="h-4 w-4" /> Vendor
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New PO
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Open PO Value"
          value={fmt(openValue)}
          hint={`${purchaseOrders.filter((p) => p.status !== "reconciled").length} active orders`}
          icon={ClipboardList}
        />
        <StatCard title="Monthly Spend" value={fmt(monthlySpend)} hint={`across ${vendors.length} vendors`} icon={CircleDollarSign} />
        <StatCard title="On-Time Delivery" value={`${avgOnTime.toFixed(0)}%`} hint="vendor average" icon={Truck} />
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Purchase Orders</h3>
          <p className="text-xs text-zinc-500">draft → sent → confirmed → delivered (stocks in) → reconciled</p>
        </div>
        {purchaseOrders.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No purchase orders"
            hint="Create one manually or use “Reorder low” in Inventory."
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New PO
              </Button>
            }
          />
        ) : (
          <Table headers={["PO", "Vendor", "Items", "Total", "Expected", "Status", ""]}>
            {purchaseOrders.map((po) => (
              <tr key={po.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-white">{po.po_number}</td>
                <td className="px-4 py-3 text-zinc-300">{po.vendor_name}</td>
                <td className="px-4 py-3 text-zinc-400">{po.items_count}</td>
                <td className="px-4 py-3 font-medium text-zinc-200">{fmt(po.total)}</td>
                <td className="px-4 py-3 text-zinc-400">{po.expected_at}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone[po.status]} className="capitalize">{po.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  {po.status !== "reconciled" && (
                    <button onClick={() => advance(po)} className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-400 hover:underline">
                      Advance <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {vendors.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="font-semibold text-white">Price Index by Vendor</h3>
            <p className="mb-3 text-xs text-zinc-500">100 = market average · lower is cheaper</p>
            <ResponsiveContainer width="100%" height={Math.max(160, vendors.length * 38)}>
              <BarChart data={vendors} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a38" horizontal={false} />
                <XAxis type="number" domain={[80, 120]} stroke="#71717a" fontSize={11} />
                <YAxis type="category" dataKey="name" stroke="#71717a" fontSize={11} width={104} tickLine={false} />
                <Tooltip {...chartTooltipStyle} formatter={(v) => [String(v), "Price index"]} />
                <ReferenceLine x={100} stroke="#fbbf24" strokeDasharray="6 4" />
                <Bar dataKey="price_index" radius={[0, 6, 6, 0]} barSize={14}>
                  {vendors.map((v) => (
                    <Cell key={v.id} fill={v.price_index <= 100 ? "#34d399" : "#fb7185"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid h-fit gap-3 sm:grid-cols-2">
            {vendors.map((v) => (
              <Card key={v.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-white">{v.name}</p>
                    <p className="text-xs text-zinc-500">{v.category}</p>
                  </div>
                  <Badge tone="amber">
                    <Star className="h-3 w-3 fill-current" /> {v.rating}
                  </Badge>
                </div>
                <div className="mt-3 flex justify-between text-xs text-zinc-400">
                  <span>
                    On-time <span className="font-semibold text-zinc-200">{v.on_time_pct}%</span>
                  </span>
                  <span>
                    Spend <span className="font-semibold text-zinc-200">{fmt(v.monthly_spend)}/mo</span>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <PriceIntelligence />

      <Modal open={creating} onClose={() => setCreating(false)} title="New Purchase Order" wide>
        <CreatePoForm onDone={() => setCreating(false)} />
      </Modal>
      <Modal open={addingVendor} onClose={() => setAddingVendor(false)} title="Add Vendor">
        <AddVendorForm onDone={() => setAddingVendor(false)} />
      </Modal>
    </div>
  );
}
