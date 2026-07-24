import type { Order, Org, Payment, OrderLine } from "./api/database.types";

/**
 * Data needed to render a customer receipt (Kundenbeleg / Rechnung).
 * Amounts come straight from the stored order columns — never recomputed —
 * because the order is the source of truth for what was actually charged.
 * Under the VAT-included model (migration 0017): line `price`s are GROSS,
 * `order.subtotal` is NET, `order.tax` is the VAT contained within, and
 * `order.total` is the gross amount the guest paid (+ tip).
 */
export interface ReceiptData {
  receiptNumber: string;
  order: Order;
  org: Org;
  payments?: Payment[];
  /** Optional overrides (else taken from org.settings). */
  customerName?: string | null;
  customerEmail?: string | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  card: "Kartenzahlung",
  cash: "Barzahlung",
  wallet: "Wallet",
  stripe: "Online (Karte)",
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: "Vor Ort",
  takeaway: "Zum Mitnehmen",
  delivery: "Lieferung",
};

function euro(n: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Render a print-ready German restaurant receipt as a self-contained HTML string.
 * Works for browser print/PDF and for emailing as an HTML body.
 */
export function generateReceiptHTML(data: ReceiptData): string {
  const { receiptNumber, order, org, payments = [] } = data;
  const settings = (org.settings ?? {}) as Record<string, unknown>;

  const address = (settings.address as string) || "";
  const taxNumber = (settings.tax_number as string) || (settings.steuernummer as string) || "";
  const vatId = (settings.vat_id as string) || (settings.ust_id as string) || "";
  const phone = (settings.phone as string) || "";
  const logoUrl = org.logo_url || "";

  const customerName = data.customerName ?? order.guest_name ?? "";
  const customerEmail = data.customerEmail ?? "";

  const created = new Date(order.created_at);
  const dateStr = created.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = created.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  const items: OrderLine[] = Array.isArray(order.items) ? order.items : [];
  const taxRate = org.tax_rate;

  // Payment methods actually recorded (can be split across several).
  const methodLabel =
    payments.length > 0
      ? Array.from(new Set(payments.map((p) => PAYMENT_LABELS[p.method] || p.method))).join(", ")
      : "—";
  const tip = order.tip || 0;

  const rows = items
    .map(
      (l) => `
      <tr>
        <td class="name">${esc(l.name)}</td>
        <td class="qty">${l.qty}</td>
        <td class="unit">${euro(l.price)}</td>
        <td class="line">${euro(l.price * l.qty)}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Beleg ${esc(receiptNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #f4f4f5; padding: 24px; }
  .sheet { max-width: 420px; margin: 0 auto; background: #fff; padding: 28px 26px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .head { display: flex; align-items: center; gap: 14px; padding-bottom: 18px; border-bottom: 1px solid #ececec; }
  .head img { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; }
  .head h1 { font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  .head .addr { font-size: 11px; color: #777; line-height: 1.5; margin-top: 3px; white-space: pre-line; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 16px 0 20px; font-size: 11.5px; }
  .meta .k { color: #999; }
  .meta .v { text-align: right; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  thead th { text-align: left; color: #999; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; padding: 0 0 8px; border-bottom: 1px solid #ececec; }
  thead th.qty, thead th.unit, thead th.line { text-align: right; }
  tbody td { padding: 9px 0; border-bottom: 1px solid #f6f6f6; vertical-align: top; }
  td.qty, td.unit, td.line { text-align: right; white-space: nowrap; }
  td.qty { width: 34px; color: #666; }
  td.unit { width: 68px; color: #666; }
  td.line { width: 76px; font-weight: 600; }
  td.name { padding-right: 8px; }
  .totals { margin-top: 14px; font-size: 12.5px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.muted { color: #777; font-size: 11.5px; }
  .totals .row.grand { font-size: 16px; font-weight: 800; margin-top: 8px; padding-top: 10px; border-top: 2px solid #1a1a1a; }
  .pay { margin-top: 16px; padding: 11px 13px; background: #f7f7f8; border-radius: 8px; font-size: 11.5px; display: flex; justify-content: space-between; }
  .legal { margin-top: 14px; font-size: 10px; color: #999; line-height: 1.6; }
  .foot { margin-top: 22px; text-align: center; font-size: 11px; color: #888; }
  @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; max-width: 100%; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="">` : ""}
      <div>
        <h1>${esc(org.name)}</h1>
        ${address || phone ? `<div class="addr">${esc(address)}${phone ? `\n${esc(phone)}` : ""}</div>` : ""}
      </div>
    </div>

    <div class="meta">
      <span class="k">Beleg-Nr.</span><span class="v">${esc(receiptNumber)}</span>
      <span class="k">Bestell-Nr.</span><span class="v">${esc(order.order_number)}</span>
      <span class="k">Datum</span><span class="v">${dateStr}, ${timeStr}</span>
      <span class="k">Art</span><span class="v">${ORDER_TYPE_LABELS[order.order_type] || order.order_type}</span>
      ${customerName ? `<span class="k">Gast</span><span class="v">${esc(customerName)}</span>` : ""}
    </div>

    <table>
      <thead>
        <tr><th class="name">Artikel</th><th class="qty">Menge</th><th class="unit">Einzel</th><th class="line">Summe</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div class="row muted"><span>Nettobetrag</span><span>${euro(order.subtotal)}</span></div>
      <div class="row muted"><span>darin enthaltene MwSt. (${taxRate}%)</span><span>${euro(order.tax)}</span></div>
      ${tip > 0 ? `<div class="row muted"><span>Trinkgeld</span><span>${euro(tip)}</span></div>` : ""}
      <div class="row grand"><span>Gesamtbetrag</span><span>${euro(order.total)}</span></div>
    </div>

    <div class="pay">
      <span>Zahlungsart</span><span><strong>${methodLabel}</strong></span>
    </div>

    <div class="legal">
      ${taxNumber ? `Steuernummer: ${esc(taxNumber)}<br>` : ""}
      ${vatId ? `USt-IdNr.: ${esc(vatId)}<br>` : ""}
      Die Umsatzsteuer ist im ausgewiesenen Betrag enthalten.
    </div>

    <div class="foot">
      Vielen Dank für Ihren Besuch!
      ${customerEmail ? `<br><span style="font-size:10px;color:#aaa">Beleg gesendet an ${esc(customerEmail)}</span>` : ""}
    </div>
  </div>
</body>
</html>`;
}
