import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  Vendor,
  PurchaseOrder,
  PurchaseOrderItem,
  PoStatus,
  InventoryItem,
  InventoryTransaction,
  SupplierItemPrice,
} from "@/lib/api/database.types";

const dVendors = demoTable<Vendor>("vendors");
const dPOs = demoTable<PurchaseOrder>("purchase_orders");
const dPoItems = demoTable<PurchaseOrderItem>("purchase_order_items");
const dItems = demoTable<InventoryItem>("inventory_items");
const dTx = demoTable<InventoryTransaction>("inventory_transactions");
const dPrices = demoTable<SupplierItemPrice>("supplier_item_prices");

const PO_FLOW: PoStatus[] = ["draft", "sent", "confirmed", "delivered", "reconciled"];

export async function listVendors(orgId: string): Promise<Vendor[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dVendors.list({ org_id: orgId } as Partial<Vendor>);
  }
  const { data, error } = await getSupabase().from("vendors").select("*").eq("org_id", orgId).order("name");
  if (error) throw error;
  return data ?? [];
}

export async function addVendor(orgId: string, v: Omit<Vendor, "id" | "org_id">): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dVendors.insert({ ...v, id: uid(), org_id: orgId });
    return;
  }
  const { error } = await getSupabase().from("vendors").insert({ ...v, org_id: orgId });
  if (error) throw error;
}

export async function listPurchaseOrders(orgId: string): Promise<PurchaseOrder[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPOs
      .list({ org_id: orgId } as Partial<PurchaseOrder>)
      .sort((a, b) => b.po_number.localeCompare(a.po_number));
  }
  const { data, error } = await getSupabase()
    .from("purchase_orders")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface NewPoInput {
  vendor_id: string | null;
  vendor_name: string;
  expected_at: string;
  items: { inventory_item_id: string | null; name: string; qty: number; unit_cost: number }[];
}

async function nextPoNumber(orgId: string): Promise<string> {
  if (!isSupabaseConfigured) {
    return `PO-${1001 + dPOs.list({ org_id: orgId } as Partial<PurchaseOrder>).length}`;
  }
  const { count } = await getSupabase()
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  return `PO-${1001 + (count ?? 0)}`;
}

export async function createPurchaseOrder(orgId: string, input: NewPoInput): Promise<string> {
  const total = +input.items.reduce((s, i) => s + i.qty * i.unit_cost, 0).toFixed(2);
  const po_number = await nextPoNumber(orgId);
  if (!isSupabaseConfigured) {
    await demoDelay();
    const po: PurchaseOrder = {
      id: uid(), org_id: orgId, po_number, vendor_id: input.vendor_id,
      vendor_name: input.vendor_name, status: "draft", expected_at: input.expected_at,
      total, items_count: input.items.length, created_at: new Date().toISOString(),
    };
    dPOs.insert(po);
    for (const it of input.items) {
      dPoItems.insert({ id: uid(), org_id: orgId, po_id: po.id, ...it });
    }
    return po_number;
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from("purchase_orders")
    .insert({
      org_id: orgId, po_number, vendor_id: input.vendor_id, vendor_name: input.vendor_name,
      expected_at: input.expected_at, total, items_count: input.items.length,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (input.items.length) {
    const { error: itemsError } = await sb.from("purchase_order_items").insert(
      input.items.map((i) => ({ org_id: orgId, po_id: data.id as string, ...i })),
    );
    if (itemsError) throw itemsError;
  }
  return po_number;
}

/** Advance a PO one step; on "delivered" the DB trigger (or demo logic) stocks items in. */
export async function advancePurchaseOrder(orgId: string, po: PurchaseOrder): Promise<PoStatus> {
  const next = PO_FLOW[Math.min(PO_FLOW.indexOf(po.status) + 1, PO_FLOW.length - 1)];
  if (!isSupabaseConfigured) {
    await demoDelay();
    dPOs.update(po.id, { status: next });
    if (next === "delivered") {
      const now = new Date().toISOString();
      for (const item of dPoItems.list({ po_id: po.id } as Partial<PurchaseOrderItem>)) {
        if (!item.inventory_item_id) continue;
        const inv = dItems.get(item.inventory_item_id);
        if (!inv) continue;
        dItems.update(inv.id, { stock: +(inv.stock + item.qty).toFixed(2) });
        dTx.insert({
          id: uid(), org_id: orgId, item_id: inv.id, item_name: item.name, delta: item.qty,
          reason: "purchase", waste_reason: null, ref_order_id: null,
          note: `PO ${po.po_number}`, created_at: now,
        });
        // Mirror the on_po_delivered trigger: record the price we just paid.
        dPrices.insert({
          id: uid(), org_id: orgId, inventory_item_id: inv.id, vendor_id: po.vendor_id,
          item_name: item.name, vendor_name: po.vendor_name, price: item.unit_cost,
          unit: inv.unit, pack_qty: item.qty, source: "po",
          bill_item_id: null, po_item_id: item.id, effective_from: now, created_at: now,
        });
      }
    }
    return next;
  }
  const { error } = await getSupabase()
    .from("purchase_orders")
    .update({ status: next })
    .eq("id", po.id)
    .eq("org_id", orgId);
  if (error) throw error;
  return next;
}

/** One-click reorder: draft POs for low-stock items, grouped by vendor. */
export async function reorderLowStock(
  orgId: string,
  lowItems: InventoryItem[],
  vendors: Vendor[],
): Promise<number> {
  const byVendor = new Map<string, InventoryItem[]>();
  for (const item of lowItems) {
    const key = item.vendor_id ?? "unassigned";
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(item);
  }
  let created = 0;
  for (const [vendorId, items] of byVendor) {
    const vendor = vendors.find((v) => v.id === vendorId);
    await createPurchaseOrder(orgId, {
      vendor_id: vendor?.id ?? null,
      vendor_name: vendor?.name ?? "Unassigned",
      expected_at: "This week",
      items: items.map((i) => ({
        inventory_item_id: i.id,
        name: i.name,
        qty: Math.max(1, +(i.par_level - i.stock).toFixed(1)),
        unit_cost: i.unit_cost,
      })),
    });
    created++;
  }
  return created;
}
