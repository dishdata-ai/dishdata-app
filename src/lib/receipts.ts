import type { Order, Org, Payment, OrderLine } from "./api/database.types";
import { computeTaxGroups } from "./tax";
import type { EscPosReceipt } from "./escpos";

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

/** German till convention: each VAT rate on the receipt gets a letter, lowest rate first. */
const RATE_LETTERS = "ABCDEFGH";

function euro(n: number): string {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Same receipt, shaped for a thermal printer instead of a browser.
 * Shares the label maps and the per-rate VAT split with the HTML version, so
 * the printed and emailed receipts can't drift apart.
 */
export function buildEscPosReceipt(data: ReceiptData, opts: { openDrawer?: boolean; columns?: number } = {}) {
  const { receiptNumber, order, org, payments = [] } = data;
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const items: OrderLine[] = Array.isArray(order.items) ? order.items : [];
  const discount = order.discount || 0;
  const groups = computeTaxGroups(items, org.tax_rate, discount);
  const letterOf = new Map(groups.map((g, i) => [g.rate, RATE_LETTERS[i] ?? "?"]));
  const showLetters = groups.length > 1;

  return {
    orgName: org.name,
    address: (settings.address as string) || null,
    phone: (settings.phone as string) || null,
    vatId: (settings.vat_id as string) || (settings.ust_id as string) || null,
    taxNumber: (settings.tax_number as string) || (settings.steuernummer as string) || null,
    receiptNumber,
    orderNumber: order.order_number,
    createdAt: order.created_at,
    orderTypeLabel: ORDER_TYPE_LABELS[order.order_type] || order.order_type,
    guestName: data.customerName ?? order.guest_name ?? null,
    lines: items.map((l) => ({
      name: l.name,
      qty: l.qty,
      price: l.price,
      taxLetter: showLetters ? letterOf.get(l.tax_rate ?? org.tax_rate) : undefined,
    })),
    gross: items.reduce((s, l) => s + l.price * l.qty, 0),
    discount,
    tip: order.tip || 0,
    total: order.total,
    taxGroups: groups.map((g) => ({ ...g, letter: showLetters ? letterOf.get(g.rate) : undefined })),
    taxTotal: order.tax,
    netTotal: order.subtotal,
    paymentLabel:
      payments.length > 0
        ? Array.from(new Set(payments.map((p) => PAYMENT_LABELS[p.method] || p.method))).join(", ")
        : "—",
    openDrawer: opts.openDrawer,
    columns: opts.columns,
  } satisfies EscPosReceipt;
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
  // A transparent-background mark (receipt_logo_url) prints cleaner on a
  // thermal roll than the main logo_url, which is often a solid-color square.
  const logoUrl = org.receipt_logo_url || org.logo_url || "";

  const customerName = data.customerName ?? order.guest_name ?? "";
  const customerEmail = data.customerEmail ?? "";

  const created = new Date(order.created_at);
  const dateStr = created.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = created.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  const items: OrderLine[] = Array.isArray(order.items) ? order.items : [];
  const tip = order.tip || 0;
  // Item lines always show the full menu price (that's what was ordered);
  // a discount is applied at the order level, so `subtotal`/`tax`/`total`
  // are already net of it. Without a line for it, the items visibly sum to
  // more than the total with no explanation — this reconciles the two.
  const discount = order.discount || 0;
  const gross = items.reduce((s, l) => s + l.price * l.qty, 0);

  // A German receipt must break VAT out per rate, because food (7%) and drinks
  // (19%) can share one order. Rates were snapshotted onto each line at
  // checkout; lines from before that (or with no per-item rate) fall back to
  // the org default, which is what was charged for them.
  const groups = computeTaxGroups(items, org.tax_rate, discount);
  const letterOf = new Map(groups.map((g, i) => [g.rate, RATE_LETTERS[i] ?? "?"]));
  const showLetters = groups.length > 1;

  // Payment methods actually recorded (can be split across several).
  const methodLabel =
    payments.length > 0
      ? Array.from(new Set(payments.map((p) => PAYMENT_LABELS[p.method] || p.method))).join(", ")
      : "—";

  // Each item's name gets its own full-width line: on an 80mm roll a fixed
  // 3-column row leaves no room for it, so it would truncate or force the
  // browser to shrink the whole receipt. Here the name always gets the line.
  const rows = items
    .map((l) => {
      const letter = showLetters ? ` ${letterOf.get(l.tax_rate ?? org.tax_rate) ?? ""}` : "";
      return `
      <div class="item">
        <div class="item-name">${esc(l.name)}</div>
        <div class="line">
          <span>${l.qty} x ${euro(l.price)}</span>
          <span class="bold">${euro(l.price * l.qty)}${letter}</span>
        </div>
      </div>`;
    })
    .join("");

  const taxRows = groups
    .map(
      (g) => `
      <tr>
        <td>${showLetters ? `${letterOf.get(g.rate)} ` : ""}${g.rate}%</td>
        <td class="r">${euro(g.tax)}</td>
        <td class="r">${euro(g.net)}</td>
        <td class="r">${euro(g.gross)}</td>
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
  body { font-family: 'Courier New', Courier, ui-monospace, monospace; color: #000; background: #f4f4f5; padding: 12px 8px; font-size: 13px; line-height: 1.4; }
  .sheet { width: 76mm; max-width: 100%; margin: 0 auto; background: #fff; padding: 5mm 3mm; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .c { text-align: center; } .r { text-align: right; } .bold { font-weight: bold; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  /* display:block kills the inline-image baseline gap, which otherwise adds
     a stray few px under the logo on top of the margin. */
  .logo { display: block; width: 120px; max-width: 55%; height: auto; margin: 0 auto 2px; }
  .org { font-size: 18px; font-weight: bold; line-height: 1.2; }
  .addr { white-space: pre-line; }
  .small { font-size: 11px; }
  .title { font-size: 16px; font-weight: bold; text-align: center; margin: 5px 0 10px; letter-spacing: 1px; }
  .line { display: flex; justify-content: space-between; gap: 8px; }
  .meta { font-size: 12px; }
  .item { padding: 4px 0; }
  .item-name { font-weight: bold; }
  .grand { font-size: 16px; font-weight: bold; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 6px 0; margin-top: 5px; }
  table { width: 100%; border-collapse: collapse; }
  .tax-table { font-size: 11px; margin-top: 15px; }
  .tax-table th { text-align: left; font-weight: bold; padding-bottom: 2px; }
  .tax-table th.r { text-align: right; }
  .tax-table td { padding: 2px 0; }
  .tax-table tr.total td { border-top: 1px dashed #000; font-weight: bold; }
  .legal { margin-top: 12px; font-size: 10px; line-height: 1.6; }

  /* Print target: an 80mm thermal roll, not a page — continuous feed, cut per
     receipt, so the height is auto. Drop the on-screen card chrome and the
     logo raster (slow and unreliable on most thermal drivers). */
  @media print {
    @page { size: 80mm auto; margin: 2mm; }
    body { background: #fff; padding: 0; }
    .sheet { width: 100%; box-shadow: none; padding: 0; }
    .logo { display: none; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="c">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="">` : ""}
      <div class="org">${esc(org.name)}</div>
      ${address ? `<div class="addr">${esc(address)}</div>` : ""}
      ${phone ? `<div>${esc(phone)}</div>` : ""}
      ${vatId ? `<div class="small" style="margin-top:4px">USt-IdNr.: ${esc(vatId)}</div>` : ""}
      ${taxNumber ? `<div class="small">Steuernummer: ${esc(taxNumber)}</div>` : ""}
    </div>

    <div class="divider"></div>
    <div class="title">RECHNUNG</div>

    <div class="meta">
      <div><strong>Rechnungs-Nr:</strong> ${esc(receiptNumber)}</div>
      <div><strong>Bestell-Nr:</strong> ${esc(order.order_number)}</div>
      <div><strong>Datum:</strong> ${dateStr}, ${timeStr}</div>
      <div><strong>Art:</strong> ${ORDER_TYPE_LABELS[order.order_type] || order.order_type}</div>
      ${customerName ? `<div><strong>Gast:</strong> ${esc(customerName)}</div>` : ""}
    </div>
    <div class="divider"></div>

    ${rows}

    <div class="divider"></div>

    ${discount > 0 ? `<div class="line"><span>Artikel gesamt</span><span>${euro(gross)}</span></div>` : ""}
    ${discount > 0 ? `<div class="line"><span>Rabatt</span><span>-${euro(discount)}</span></div>` : ""}
    ${tip > 0 ? `<div class="line"><span>Trinkgeld</span><span>${euro(tip)}</span></div>` : ""}

    <div class="grand">
      <div class="line"><span>Summe EUR</span><span>${euro(order.total)}</span></div>
    </div>

    <table class="tax-table">
      <thead>
        <tr>
          <th>USt.%</th><th class="r">USt.</th><th class="r">Netto</th><th class="r">Brutto</th>
        </tr>
      </thead>
      <tbody>
        ${taxRows}
        <tr class="total">
          <td>Total</td>
          <td class="r">${euro(order.tax)}</td>
          <td class="r">${euro(order.subtotal)}</td>
          <td class="r">${euro(order.subtotal + order.tax)}</td>
        </tr>
      </tbody>
    </table>

    <div class="divider"></div>
    <div class="line"><span>Zahlungsart</span><span class="bold">${esc(methodLabel)}</span></div>

    <div class="legal">Die Umsatzsteuer ist im ausgewiesenen Betrag enthalten.</div>

    <div class="divider"></div>
    <div class="c bold" style="margin-top: 10px;">Vielen Dank für Ihren Besuch!</div>
    ${customerEmail ? `<div class="c small" style="margin-top:4px">Beleg gesendet an ${esc(customerEmail)}</div>` : ""}
  </div>
</body>
</html>`;
}
