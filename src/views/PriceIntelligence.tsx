"use client";

import { useMemo, useState, useRef } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Tag,
  Boxes,
  PiggyBank,
  LineChart as LineChartIcon,
  Plus,
  ChevronDown,
  Upload,
} from "lucide-react";
import {
  Card,
  StatCard,
  Badge,
  Button,
  Modal,
  Field,
  Select,
  Input,
  EmptyState,
} from "@/components/ui";
import { useInventory, useVendors, useSupplierPrices, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { recordSupplierPrice, buildComparisons, type ItemPriceComparison } from "@/lib/api/pricing";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import BillReviewModal from "@/components/BillReviewModal";

/** Tiny dependency-free sparkline for a price history series. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-xs text-zinc-600">—</span>;
  const w = 96;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "#fb7185" : "#34d399"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-zinc-600">new</span>;
  if (Math.abs(pct) < 0.05)
    return (
      <Badge tone="neutral">
        <Minus className="h-3 w-3" /> flat
      </Badge>
    );
  const up = pct > 0;
  return (
    <Badge tone={up ? "rose" : "green"}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {pct.toFixed(1)}%
    </Badge>
  );
}

export default function PriceIntelligence() {
  const { org } = useOrg();
  const fmt = useFmt();
  const pricesQ = useSupplierPrices();
  const vendorsQ = useVendors();
  const invalidate = useInvalidate();

  const [recording, setRecording] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploadingBill, setUploadingBill] = useState(false);
  const [extractedBill, setExtractedBill] = useState<any>(null);
  const [showBillReview, setShowBillReview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const comparisons = useMemo(() => buildComparisons(pricesQ.data ?? []), [pricesQ.data]);

  const handleBillUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingBill(true);
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/bills/extract", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!result.success) {
        throw new Error(result.error || "Failed to extract bill");
      }

      setExtractedBill(result.data);
      setShowBillReview(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload bill");
    } finally {
      setUploadingBill(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const tracked = comparisons.length;
  const totalPoints = (pricesQ.data ?? []).length;
  const rising = comparisons.filter((c) => c.changePct !== null && c.changePct > 0.05).length;
  const potentialSavings = comparisons.reduce(
    (s, c) => s + (c.latest ? c.saveVsBest * c.latest.pack_qty : 0),
    0,
  );

  if (totalPoints === 0) {
    return (
      <Card>
        <EmptyState
          icon={LineChartIcon}
          title="No price history yet"
          hint="Deliver a purchase order (prices are captured automatically), photograph a supplier bill, or record a price by hand to start comparing vendors."
          action={
            <div className="flex gap-2">
              <Button onClick={() => setRecording(true)}>
                <Plus className="h-4 w-4" /> Record price
              </Button>
              <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploadingBill}>
                <Upload className="h-4 w-4" /> Upload bill
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                onChange={handleBillUpload}
                className="hidden"
              />
            </div>
          }
        />
        <RecordPriceModal
          open={recording}
          onClose={() => setRecording(false)}
          onSaved={() => invalidate("supplier_prices")}
          orgId={org?.id}
        />
        <BillReviewModal
          isOpen={showBillReview}
          billData={extractedBill}
          onClose={() => setShowBillReview(false)}
          onConfirm={() => invalidate("supplier_prices")}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-white">Price Intelligence</h3>
          <p className="text-xs text-zinc-500">
            Per-item vendor prices over time — spot increases and the cheapest seller.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setRecording(true)}>
            <Plus className="h-4 w-4" /> Record price
          </Button>
          <Button variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={uploadingBill}>
            <Upload className="h-4 w-4" /> Upload bill
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            onChange={handleBillUpload}
            className="hidden"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Items Tracked" value={String(tracked)} hint={`${totalPoints} price points`} icon={Boxes} />
        <StatCard title="Prices Rising" value={String(rising)} hint="vs previous purchase" icon={TrendingUp} trendGoodWhenDown />
        <StatCard title="Potential Savings" value={fmt(potentialSavings)} hint="switch to cheapest vendor" icon={PiggyBank} />
        <StatCard title="Vendors Compared" value={String(vendorsQ.data?.length ?? 0)} hint="across your catalog" icon={Tag} />
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Items</h3>
          <p className="text-xs text-zinc-500">Tap a row to compare every vendor and see the trend.</p>
        </div>
        <div className="divide-y divide-line">
          {comparisons.map((c) => (
            <ItemRow
              key={c.key}
              c={c}
              fmt={fmt}
              open={expanded === c.key}
              onToggle={() => setExpanded((e) => (e === c.key ? null : c.key))}
            />
          ))}
        </div>
      </Card>

      <RecordPriceModal
        open={recording}
        onClose={() => setRecording(false)}
        onSaved={() => invalidate("supplier_prices")}
        orgId={org?.id}
      />

      <BillReviewModal
        isOpen={showBillReview}
        billData={extractedBill}
        onClose={() => setShowBillReview(false)}
        onConfirm={() => invalidate("supplier_prices")}
      />
    </div>
  );
}

function ItemRow({
  c,
  fmt,
  open,
  onToggle,
}: {
  c: ItemPriceComparison;
  fmt: (n: number, d?: number) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const unitLabel = c.unit ? `/${c.unit}` : "";
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-180")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{c.item_name}</p>
          <p className="text-xs text-zinc-500">
            {c.vendors.length} vendor{c.vendors.length === 1 ? "" : "s"}
            {c.best && (
              <>
                {" · "}cheapest <span className="text-brand-300">{c.best.vendor_name}</span> at{" "}
                {fmt(c.best.unitPrice, 2)}
                {unitLabel}
              </>
            )}
          </p>
        </div>
        <div className="hidden sm:block">
          <Sparkline values={c.history.map((h) => h.unitPrice)} />
        </div>
        <div className="w-24 shrink-0 text-right">
          <p className="text-sm font-semibold text-white">{c.latest ? fmt(c.latest.unitPrice, 2) : "—"}</p>
          <p className="text-[11px] text-zinc-500">last paid{unitLabel}</p>
        </div>
        <div className="w-20 shrink-0 text-right">
          <ChangeBadge pct={c.changePct} />
        </div>
      </button>

      {open && (
        <div className="space-y-2 bg-white/[0.015] px-4 pb-4 pt-1">
          {c.saveVsBest > 0 && c.latest && c.best && (
            <p className="rounded-lg bg-brand-400/10 px-3 py-2 text-xs text-brand-300">
              You last paid {fmt(c.latest.unitPrice, 2)}
              {unitLabel} with {c.latest.vendor_name}. {c.best.vendor_name} is{" "}
              {fmt(c.saveVsBest, 2)}
              {unitLabel} cheaper — about {fmt(c.saveVsBest * c.latest.pack_qty, 2)} per order.
            </p>
          )}
          {c.vendors.map((v) => {
            const isBest = v.vendor_id === c.best?.vendor_id && v.vendor_name === c.best?.vendor_name;
            return (
              <div
                key={`${v.vendor_id}-${v.vendor_name}`}
                className="flex items-center justify-between rounded-lg border border-line bg-white/[0.02] px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm text-zinc-200">
                  {v.vendor_name}
                  {isBest && <Badge tone="green">best price</Badge>}
                </span>
                <span className="text-right text-sm">
                  <span className="font-semibold text-white">{fmt(v.unitPrice, 2)}</span>
                  <span className="text-zinc-500">{unitLabel}</span>
                  {v.pack_qty !== 1 && (
                    <span className="ml-2 text-[11px] text-zinc-500">
                      ({fmt(v.price, 2)} / {v.pack_qty} {v.unit ?? ""})
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RecordPriceModal({
  open,
  onClose,
  onSaved,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  orgId?: string;
}) {
  const inventoryQ = useInventory();
  const vendorsQ = useVendors();
  const items = inventoryQ.data ?? [];
  const vendors = vendorsQ.data ?? [];

  const [itemId, setItemId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [price, setPrice] = useState("");
  const [packQty, setPackQty] = useState("1");
  const [saving, setSaving] = useState(false);

  const item = items.find((i) => i.id === itemId);
  const vendor = vendors.find((v) => v.id === vendorId);

  const save = async () => {
    if (!orgId || !item || !vendor || !price) {
      toast.error("Fill in item, vendor and price");
      return;
    }
    setSaving(true);
    try {
      await recordSupplierPrice(orgId, {
        inventory_item_id: item.id,
        vendor_id: vendor.id,
        item_name: item.name,
        vendor_name: vendor.name,
        price: +price,
        unit: item.unit,
        pack_qty: +packQty || 1,
      });
      toast.success("Price recorded", `${item.name} · ${vendor.name}`);
      onSaved();
      setPrice("");
      setItemId("");
      setVendorId("");
      setPackQty("1");
      onClose();
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record a supplier price">
      <div className="space-y-3">
        <Field label="Item">
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Select item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor">
          <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price paid">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label={`Pack qty${item ? ` (${item.unit})` : ""}`}>
            <Input
              type="number"
              inputMode="decimal"
              value={packQty}
              onChange={(e) => setPackQty(e.target.value)}
            />
          </Field>
        </div>
        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Record price"}
        </Button>
      </div>
    </Modal>
  );
}
