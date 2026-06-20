import { useState, useMemo, useEffect } from "react";
import { Button, Input, Select, Badge, Modal } from "@/components/ui";
import { useInventory, useVendors } from "@/lib/hooks/data";
import {
  fuzzyMatchInventoryItem,
  fuzzyMatchVendor,
  createSupplierBill,
  confirmBillAndRecordPrices,
} from "@/lib/api/pricing";
import { useOrg } from "@/lib/hooks/useOrg";
import { toast } from "@/lib/toast";

interface ExtractedBillData {
  vendor_name: string;
  bill_date: string | null;
  line_items: {
    name: string;
    qty: number;
    unit: string;
    unit_price: number;
  }[];
  raw_extract?: unknown;
}

interface BillLineItemMatch {
  rawName: string;
  qty: number;
  unit: string;
  unitPrice: number;
  matchedItemId: string | null;
  matchedItemName?: string;
}

interface Props {
  isOpen: boolean;
  billData: ExtractedBillData | null;
  onClose: () => void;
  onConfirm?: () => void;
}

export default function BillReviewModal({ isOpen, billData, onClose, onConfirm }: Props) {
  const { org } = useOrg();
  const inventoryQ = useInventory();
  const inventory = inventoryQ.data ?? [];
  const vendorsQ = useVendors();
  const vendors = vendorsQ.data ?? [];

  const [matches, setMatches] = useState<BillLineItemMatch[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [updateCosts, setUpdateCosts] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auto-match vendor name to an existing vendor record when the bill arrives.
  const suggestedVendor = useMemo(
    () => (billData ? fuzzyMatchVendor(billData.vendor_name, vendors) : null),
    [billData, vendors],
  );
  useEffect(() => {
    setVendorId(suggestedVendor?.id ?? null);
  }, [suggestedVendor]);

  // Initialize matches when bill data changes
  useMemo(() => {
    if (!billData) return;
    const initialMatches = billData.line_items.map((item) => {
      const matched = fuzzyMatchInventoryItem(item.name, inventory);
      return {
        rawName: item.name,
        qty: item.qty,
        unit: item.unit,
        unitPrice: item.unit_price,
        matchedItemId: matched?.id || null,
        matchedItemName: matched?.name,
      };
    });
    setMatches(initialMatches);
    setError(null);
  }, [billData, inventory]);

  const handleMatchChange = (index: number, itemId: string) => {
    setMatches((prev) => {
      const next = [...prev];
      const item = inventory.find((i) => i.id === itemId);
      next[index] = {
        ...next[index],
        matchedItemId: itemId || null,
        matchedItemName: item?.name,
      };
      return next;
    });
  };

  const handleQtyChange = (index: number, qty: number) => {
    setMatches((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], qty };
      return next;
    });
  };

  const handlePriceChange = (index: number, unitPrice: number) => {
    setMatches((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], unitPrice };
      return next;
    });
  };

  const handleConfirm = async () => {
    if (!billData || !org) return;
    try {
      setIsConfirming(true);
      setError(null);

      // Resolve the vendor name: use the linked record's name if matched, else the extracted text.
      const vendorName = vendors.find((v) => v.id === vendorId)?.name ?? billData.vendor_name;

      // Create bill with matched items. The bill carries vendor_id + each line's
      // inventory_item_id, so confirm can record prices without extra id plumbing.
      const billId = await createSupplierBill(org.id, {
        vendor_id: vendorId,
        vendor_name: vendorName,
        bill_date: billData.bill_date,
        line_items: matches.map((m) => ({
          raw_name: m.rawName,
          qty: m.qty,
          unit: m.unit,
          unit_price: m.unitPrice,
          inventory_item_id: m.matchedItemId,
        })),
      });

      // Bill items already store their inventory_item_id; no override needed.
      await confirmBillAndRecordPrices(org.id, billId, [], updateCosts);

      toast.success(`Bill recorded: ${vendorName} with ${matches.length} items`);

      // Close modal and notify parent
      onClose();
      if (onConfirm) onConfirm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to confirm bill";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsConfirming(false);
    }
  };

  if (!isOpen || !billData) return null;

  return (
    <Modal open={isOpen} onClose={onClose} title="Review Supplier Bill" wide>
      <p className="mb-4 text-sm text-zinc-400">
        Match extracted line items to your inventory, then confirm to record prices.
      </p>

      <div className="space-y-4">
        {/* Bill header */}
        <div className="space-y-3 rounded-lg bg-zinc-900/50 p-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-zinc-500">VENDOR</p>
              {vendorId ? (
                <Badge tone="green">linked</Badge>
              ) : (
                <Badge tone="amber">new vendor</Badge>
              )}
            </div>
            <p className="mb-2 text-sm text-zinc-400">
              Extracted as “{billData.vendor_name}”
              {suggestedVendor && vendorId === suggestedVendor.id && (
                <span className="text-zinc-500"> · auto-matched to {suggestedVendor.name}</span>
              )}
            </p>
            <Select value={vendorId ?? ""} onChange={(e) => setVendorId(e.target.value || null)}>
              <option value="">Keep as new “{billData.vendor_name}” (don’t link)</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
          </div>
          {billData.bill_date && (
            <div>
              <p className="text-xs font-semibold text-zinc-500">DATE</p>
              <p className="text-sm text-white">{billData.bill_date}</p>
            </div>
          )}
        </div>

        {/* Line items */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-zinc-300">Line Items ({matches.length})</p>
          {matches.map((item, idx) => (
            <div key={idx} className="space-y-2 rounded-lg border border-line bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm text-zinc-400">{item.rawName}</p>
                  {item.matchedItemName && (
                    <Badge tone="neutral" className="mt-1">
                      Matched: {item.matchedItemName}
                    </Badge>
                  )}
                </div>
                {!item.matchedItemId && <Badge tone="rose">Unmatched</Badge>}
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                {/* Match selector */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1">Item</label>
                  <Select
                    value={item.matchedItemId || ""}
                    onChange={(e) => handleMatchChange(idx, e.target.value)}
                  >
                    <option value="">— Select —</option>
                    {inventory.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Qty */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1">Qty</label>
                  <Input
                    type="number"
                    value={item.qty}
                    onChange={(e) => handleQtyChange(idx, parseFloat(e.target.value) || 0)}
                    className="text-sm"
                  />
                </div>

                {/* Unit */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1">Unit</label>
                  <Input
                    type="text"
                    value={item.unit}
                    onChange={(e) =>
                      setMatches((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], unit: e.target.value };
                        return next;
                      })
                    }
                    placeholder="kg, lb, etc"
                    className="text-sm"
                  />
                </div>

                {/* Price */}
                <div className="sm:col-span-1">
                  <label className="block text-xs font-semibold text-zinc-500 mb-1">Unit Price</label>
                  <Input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => handlePriceChange(idx, parseFloat(e.target.value) || 0)}
                    step="0.01"
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Options */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={updateCosts}
            onChange={(e) => setUpdateCosts(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border border-line bg-zinc-950 accent-brand-500"
          />
          <span className="text-sm text-zinc-300">Update inventory unit costs from this bill</span>
        </label>

        {error && <div className="rounded-lg bg-rose-500/20 px-3 py-2 text-sm text-rose-300">{error}</div>}

        {/* Actions */}
        <div className="mt-6 flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isConfirming}>
            {isConfirming ? "Confirming…" : "Confirm"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
