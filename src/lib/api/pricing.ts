import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  SupplierItemPrice,
  SupplierBill,
  SupplierBillItem,
  PriceSource,
  InventoryItem,
  Vendor,
} from "@/lib/api/database.types";

const dPrices = demoTable<SupplierItemPrice>("supplier_item_prices");
const dBills = demoTable<SupplierBill>("supplier_bills");
const dBillItems = demoTable<SupplierBillItem>("supplier_bill_items");

export async function listSupplierPrices(orgId: string): Promise<SupplierItemPrice[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPrices
      .list({ org_id: orgId } as Partial<SupplierItemPrice>)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  }
  const { data, error } = await getSupabase()
    .from("supplier_item_prices")
    .select("*")
    .eq("org_id", orgId)
    .order("effective_from", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface RecordPriceInput {
  inventory_item_id: string | null;
  vendor_id: string | null;
  item_name: string;
  vendor_name: string;
  price: number;
  unit: string | null;
  pack_qty: number;
  source?: PriceSource;
}

/** Manually log an observed supplier price (e.g. a quote or counter price). */
export async function recordSupplierPrice(orgId: string, input: RecordPriceInput): Promise<void> {
  const row = { ...input, source: input.source ?? ("manual" as PriceSource) };
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPrices.insert({
      ...row,
      id: uid(),
      org_id: orgId,
      bill_item_id: null,
      po_item_id: null,
      effective_from: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await getSupabase().from("supplier_item_prices").insert({ ...row, org_id: orgId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Pure comparison helpers (used by the Price Intelligence view).
// ---------------------------------------------------------------------------

export interface VendorPrice {
  vendor_id: string | null;
  vendor_name: string;
  price: number;
  unit: string | null;
  pack_qty: number;
  at: string;
  /** Unit-normalised price (price / pack_qty) for fair comparison. */
  unitPrice: number;
}

export interface ItemPriceComparison {
  key: string;
  item_name: string;
  inventory_item_id: string | null;
  unit: string | null;
  /** Latest price per vendor, cheapest first. */
  vendors: VendorPrice[];
  history: { at: string; unitPrice: number; vendor_name: string }[];
  best: VendorPrice | null;
  /** Most recent observation across all vendors. */
  latest: VendorPrice | null;
  /** Previous observation for the latest vendor, for trend %. */
  prevForLatest: number | null;
  /** % change of the latest vendor vs its previous price (null if first). */
  changePct: number | null;
  /** Savings/unit if the latest purchase switched to the cheapest vendor. */
  saveVsBest: number;
}

const norm = (p: { price: number; pack_qty: number }) =>
  p.pack_qty > 0 ? p.price / p.pack_qty : p.price;

/** Group a flat price list into per-item vendor comparisons. */
export function buildComparisons(prices: SupplierItemPrice[]): ItemPriceComparison[] {
  const byItem = new Map<string, SupplierItemPrice[]>();
  for (const p of prices) {
    const key = p.inventory_item_id ?? `name:${p.item_name.toLowerCase()}`;
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key)!.push(p);
  }

  const out: ItemPriceComparison[] = [];
  for (const [key, rows] of byItem) {
    // rows arrive newest-first (list is sorted desc by effective_from).
    const sortedDesc = [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

    // Latest price per vendor.
    const latestByVendor = new Map<string, VendorPrice>();
    for (const r of sortedDesc) {
      const vk = r.vendor_id ?? `name:${r.vendor_name.toLowerCase()}`;
      if (!latestByVendor.has(vk)) {
        latestByVendor.set(vk, {
          vendor_id: r.vendor_id,
          vendor_name: r.vendor_name || "Unknown",
          price: r.price,
          unit: r.unit,
          pack_qty: r.pack_qty,
          at: r.effective_from,
          unitPrice: norm(r),
        });
      }
    }
    const vendors = [...latestByVendor.values()].sort((a, b) => a.unitPrice - b.unitPrice);
    const best = vendors[0] ?? null;

    const latestRow = sortedDesc[0];
    const latest = latestRow
      ? {
          vendor_id: latestRow.vendor_id,
          vendor_name: latestRow.vendor_name || "Unknown",
          price: latestRow.price,
          unit: latestRow.unit,
          pack_qty: latestRow.pack_qty,
          at: latestRow.effective_from,
          unitPrice: norm(latestRow),
        }
      : null;

    // Previous price from the SAME vendor as the latest observation.
    let prevForLatest: number | null = null;
    if (latestRow) {
      const vk = latestRow.vendor_id ?? `name:${latestRow.vendor_name.toLowerCase()}`;
      const sameVendor = sortedDesc.filter(
        (r) => (r.vendor_id ?? `name:${r.vendor_name.toLowerCase()}`) === vk,
      );
      if (sameVendor.length > 1) prevForLatest = norm(sameVendor[1]);
    }
    const changePct =
      latest && prevForLatest && prevForLatest > 0
        ? ((latest.unitPrice - prevForLatest) / prevForLatest) * 100
        : null;

    const history = [...sortedDesc]
      .reverse()
      .map((r) => ({ at: r.effective_from, unitPrice: norm(r), vendor_name: r.vendor_name || "Unknown" }));

    out.push({
      key,
      item_name: latestRow?.item_name || rows[0].item_name,
      inventory_item_id: rows[0].inventory_item_id,
      unit: latestRow?.unit ?? null,
      vendors,
      history,
      best,
      latest,
      prevForLatest,
      changePct,
      saveVsBest: latest && best ? Math.max(0, latest.unitPrice - best.unitPrice) : 0,
    });
  }

  return out.sort((a, b) => a.item_name.localeCompare(b.item_name));
}

// ---------------------------------------------------------------------------
// Fuzzy string matching for item name → inventory item lookup
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const alen = a.length,
    blen = b.length;
  const dp = Array(blen + 1)
    .fill(null)
    .map(() => Array(alen + 1).fill(0));
  for (let i = 0; i <= alen; i++) dp[0][i] = i;
  for (let j = 0; j <= blen; j++) dp[j][0] = j;
  for (let j = 1; j <= blen; j++) {
    for (let i = 1; i <= alen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j][i] = Math.min(
        dp[j][i - 1] + 1,
        dp[j - 1][i] + 1,
        dp[j - 1][i - 1] + cost,
      );
    }
  }
  return dp[blen][alen];
}

export function fuzzyMatchInventoryItem(
  billItemName: string,
  items: InventoryItem[],
): InventoryItem | null {
  const query = billItemName.toLowerCase().trim();
  const matches = items
    .map((item) => ({
      item,
      score: levenshtein(query, item.name.toLowerCase()),
    }))
    .sort((a, b) => a.score - b.score);

  // Return best match if within threshold (distance ≤ 20% of query length)
  const best = matches[0];
  if (best && best.score <= Math.max(2, query.length * 0.2)) {
    return best.item;
  }
  return null;
}

export function fuzzyMatchVendor(
  vendorName: string,
  vendors: Vendor[],
): Vendor | null {
  const query = vendorName.toLowerCase().trim();
  if (!query) return null;

  // Exact or substring match wins outright (vendor names are short & distinctive)
  const contains = vendors.find((v) => {
    const name = v.name.toLowerCase();
    return name === query || name.includes(query) || query.includes(name);
  });
  if (contains) return contains;

  const matches = vendors
    .map((v) => ({ vendor: v, score: levenshtein(query, v.name.toLowerCase()) }))
    .sort((a, b) => a.score - b.score);

  const best = matches[0];
  if (best && best.score <= Math.max(2, query.length * 0.3)) {
    return best.vendor;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bill ingestion (from AI extraction or manual upload)
// ---------------------------------------------------------------------------

export interface CreateBillInput {
  vendor_id: string | null;
  vendor_name: string;
  bill_date: string | null;
  image_url?: string;
  line_items: {
    raw_name: string;
    qty: number;
    unit: string | null;
    unit_price: number;
    inventory_item_id?: string | null;
  }[];
}

export async function createSupplierBill(
  orgId: string,
  input: CreateBillInput,
): Promise<string> {
  // billId
  if (!isSupabaseConfigured) {
    await demoDelay();
    const bill: SupplierBill = {
      id: uid(),
      org_id: orgId,
      vendor_id: input.vendor_id || null,
      vendor_name: input.vendor_name,
      bill_date: input.bill_date,
      total: 0,
      image_url: input.image_url || null,
      status: "reviewed",
      raw_extract: null,
      created_at: new Date().toISOString(),
    };
    dBills.insert(bill);
    // Insert bill items
    for (const item of input.line_items) {
      dBillItems.insert({
        id: uid(),
        org_id: orgId,
        bill_id: bill.id,
        inventory_item_id: item.inventory_item_id || null,
        raw_name: item.raw_name,
        qty: item.qty,
        unit: item.unit,
        unit_price: item.unit_price,
      });
    }
    return bill.id;
  }

  const sb = getSupabase();
  // Create bill
  const { data: billData, error: billError } = await sb
    .from("supplier_bills")
    .insert({
      org_id: orgId,
      vendor_id: input.vendor_id || null,
      vendor_name: input.vendor_name,
      bill_date: input.bill_date,
      image_url: input.image_url || null,
      status: "reviewed",
      total: 0,
    })
    .select("id")
    .single();
  if (billError) throw billError;

  // Create bill items
  const billItemsData = input.line_items.map((item) => ({
    org_id: orgId,
    bill_id: billData.id,
    inventory_item_id: item.inventory_item_id || null,
    raw_name: item.raw_name,
    qty: item.qty,
    unit: item.unit,
    unit_price: item.unit_price,
  }));
  const { error: itemsError } = await sb
    .from("supplier_bill_items")
    .insert(billItemsData);
  if (itemsError) throw itemsError;

  return billData.id;
}

export async function confirmBillAndRecordPrices(
  orgId: string,
  billId: string,
  matchedItems: Array<{ bill_item_id: string; inventory_item_id: string | null }>,
  updateInventoryCosts: boolean,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    // Mark bill as confirmed
    dBills.update(billId, { status: "confirmed" });
    // Get bill items and create prices
    const billItems = dBillItems.list({ bill_id: billId } as Partial<SupplierBillItem>);
    const invItems = demoTable<InventoryItem>("inventory_items");
    const bill = dBills.get(billId) as SupplierBill;
    for (const billItem of billItems) {
      const override = matchedItems.find((m) => m.bill_item_id === billItem.id);
      const invId = override?.inventory_item_id ?? billItem.inventory_item_id;
      if (!invId) continue;
      const invItem = invItems.get(invId);
      if (!invItem) continue;
      // Record price
      dPrices.insert({
        id: uid(),
        org_id: orgId,
        inventory_item_id: invId,
        vendor_id: bill.vendor_id, // Links price history to the matched vendor record
        item_name: billItem.raw_name,
        vendor_name: bill.vendor_name,
        price: billItem.unit_price,
        unit: billItem.unit,
        pack_qty: billItem.qty,
        source: "invoice",
        bill_item_id: billItem.id,
        po_item_id: null,
        effective_from: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
      // Optionally update inventory item cost
      if (updateInventoryCosts) {
        invItems.update(invId, { unit_cost: billItem.unit_price });
      }
    }
    return;
  }

  const sb = getSupabase();
  // Mark bill as confirmed
  await sb.from("supplier_bills").update({ status: "confirmed" }).eq("id", billId);

  // Get bill and items
  const { data: billData } = await sb
    .from("supplier_bills")
    .select("*")
    .eq("id", billId)
    .single();
  const { data: itemsData } = await sb
    .from("supplier_bill_items")
    .select("*")
    .eq("bill_id", billId);

  if (!billData || !itemsData) return;

  // Create price records for matched items
  const priceRows = itemsData
    .map((item) => {
      const override = matchedItems.find((m) => m.bill_item_id === item.id);
      const invId = override?.inventory_item_id ?? item.inventory_item_id;
      if (!invId) return null;
      return {
        org_id: orgId,
        inventory_item_id: invId,
        vendor_id: billData.vendor_id,
        item_name: item.raw_name,
        vendor_name: billData.vendor_name,
        price: item.unit_price,
        unit: item.unit,
        pack_qty: item.qty,
        source: "invoice" as PriceSource,
        bill_item_id: item.id,
        po_item_id: null,
      };
    })
    .filter((r) => r !== null);

  if (priceRows.length > 0) {
    await sb.from("supplier_item_prices").insert(priceRows);
  }

  // Optionally update inventory item costs
  if (updateInventoryCosts) {
    for (const item of itemsData) {
      const override = matchedItems.find((m) => m.bill_item_id === item.id);
      const invId = override?.inventory_item_id ?? item.inventory_item_id;
      if (invId) {
        await sb
          .from("inventory_items")
          .update({ unit_cost: item.unit_price })
          .eq("id", invId);
      }
    }
  }
}
