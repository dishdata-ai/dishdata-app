import QRCode from "qrcode";
import type { InventoryItem, StorageLocation } from "@/lib/api/database.types";

/** The value encoded in an item's QR/label — its SKU if set, else its id. */
export const labelCode = (item: InventoryItem) => item.sku || item.id;

export const locationLabel = (loc?: StorageLocation | null) =>
  loc ? [loc.area, loc.shelf].filter(Boolean).join(" · ") || loc.name : "Unassigned";

const monthsSince = (iso: string) => {
  const then = new Date(iso).getTime();
  return (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
};

/**
 * Straight-line depreciated book value of an equipment asset.
 * Returns null for non-assets (no purchase cost).
 */
export function bookValue(item: InventoryItem): number | null {
  if (item.purchase_cost == null) return null;
  if (!item.purchase_date || !item.depreciation_months) return item.purchase_cost;
  const used = Math.min(1, monthsSince(item.purchase_date) / item.depreciation_months);
  return Math.max(0, +(item.purchase_cost * (1 - used)).toFixed(2));
}

/** Open a print-ready window with a QR label for an item. */
export async function printLabel(item: InventoryItem, location: string) {
  const code = labelCode(item);
  const dataUrl = await QRCode.toDataURL(code, { width: 260, margin: 1 });
  const win = window.open("", "_blank", "width=380,height=520");
  if (!win) return;
  win.document.write(`
    <html><head><title>Label — ${item.name}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; text-align: center; padding: 24px; }
      img { width: 220px; height: 220px; image-rendering: pixelated; }
      h1 { font-size: 18px; margin: 12px 0 2px; }
      .meta { font-size: 13px; color: #444; }
      .code { font-family: ui-monospace, monospace; font-size: 14px; margin-top: 6px; }
    </style></head>
    <body>
      <img src="${dataUrl}" alt="QR" />
      <h1>${item.name}</h1>
      <div class="meta">${location}</div>
      <div class="code">${code}</div>
      <script>window.onload = () => { window.print(); };</script>
    </body></html>`);
  win.document.close();
}
