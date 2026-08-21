/**
 * Thermal receipt rendering for direct printing — no browser print dialog.
 *
 * The layout is built once as a list of directives, then rendered either as
 * raw ESC/POS bytes (USB, Bluetooth, a LAN socket on port 9100, a local print
 * agent) or as ePOS-Print XML for an Epson TM printer's built-in web service.
 * Keeping one layout and two renderers means the receipt can't drift between
 * transports.
 *
 * Character encoding is what bites on a German receipt. ESC/POS printers are
 * not UTF-8 — they use single-byte code pages — so the byte renderer selects
 * CP858 (umlauts, ß, €) and maps what we emit. The XML renderer sends UTF-8
 * and lets the printer's web service handle it.
 */

/** Font A on an 80mm roll is 48 columns. 58mm rolls are 32 — set per printer. */
export const DEFAULT_COLUMNS = 48;

const ESC = 0x1b;
const GS = 0x1d;

/** CP858 byte for characters outside plain ASCII that a German receipt needs. */
const CP858: Record<string, number> = {
  "ä": 0x84, "ö": 0x94, "ü": 0x81,
  "Ä": 0x8e, "Ö": 0x99, "Ü": 0x9a,
  "ß": 0xe1, "€": 0xd5,
  "á": 0xa0, "é": 0x82, "í": 0xa1, "ó": 0xa2, "ú": 0xa3,
  "à": 0x85, "è": 0x8a, "ç": 0x87, "ñ": 0xa4,
  "°": 0xf8,
};

/** Last-resort ASCII for characters with no CP858 byte, so nothing prints as noise. */
const ASCII_FALLBACK: Record<string, string> = {
  "–": "-", "—": "-", "‑": "-",
  "“": '"', "”": '"', "„": '"',
  "‘": "'", "’": "'",
  "…": "...", "×": "x", "→": "->", "•": "*",
};

// ---------------------------------------------------------------------------
// Directive model — the transport-independent description of a receipt.
// ---------------------------------------------------------------------------
type Align = "left" | "center" | "right";

type Directive =
  | { t: "text"; s: string; align?: Align; bold?: boolean; dw?: boolean; dh?: boolean }
  | { t: "qr"; data: string }
  | { t: "feed"; n: number }
  | { t: "cut" }
  | { t: "pulse" };

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Wrap text to `width` columns without breaking words where avoidable. */
function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += " " + w;
    else {
      out.push(cur);
      cur = w;
    }
    // A single word longer than the line still has to be broken somewhere.
    while (cur.length > width) {
      out.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [""];
}

/** "Item              12,34" — left text, right text, padded to the full width. */
function columns(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap >= 1) return left + " ".repeat(gap) + right;
  // Too long to share a line: give `right` the space it needs and truncate left.
  const room = Math.max(0, width - right.length - 1);
  return left.slice(0, room) + " " + right;
}

const money = (n: number) => n.toFixed(2).replace(".", ",");

// ---------------------------------------------------------------------------
// Receipt shape
// ---------------------------------------------------------------------------
export interface EscPosLine {
  name: string;
  qty: number;
  price: number;
  /** Letter shown against the line when an order mixes VAT rates (A/B/…). */
  taxLetter?: string;
}

export interface EscPosTaxGroup {
  rate: number;
  tax: number;
  net: number;
  gross: number;
  letter?: string;
}

export interface EscPosReceipt {
  orgName: string;
  address?: string | null;
  phone?: string | null;
  vatId?: string | null;
  taxNumber?: string | null;
  receiptNumber: string;
  orderNumber: string;
  createdAt: string;
  orderTypeLabel: string;
  guestName?: string | null;
  lines: EscPosLine[];
  /** Sum of the line prices before any discount. */
  gross: number;
  discount: number;
  tip: number;
  total: number;
  taxGroups: EscPosTaxGroup[];
  taxTotal: number;
  netTotal: number;
  paymentLabel: string;
  /** Pop the cash drawer as part of this job. */
  openDrawer?: boolean;
  columns?: number;
  /**
   * TSE signature block (KassenSichV §6). The QR carries every required field,
   * so printing it means the plain-text values are only a fallback.
   */
  tseQrData?: string | null;
  tseLines?: string[];
  /** Set when the TSE was unreachable — the receipt must say so plainly. */
  tseFailed?: boolean;
}

/**
 * Build the receipt as directives. Layout mirrors the printed HTML receipt:
 * header, RECHNUNG, meta, items with the name on its own line, totals, then
 * the per-rate USt. table German law requires.
 */
export function buildReceipt(r: EscPosReceipt): Directive[] {
  const w = r.columns ?? DEFAULT_COLUMNS;
  const d: Directive[] = [];
  const rule = "-".repeat(w);
  const dt = new Date(r.createdAt);
  // Pinned to Europe/Berlin for the same reason as generateReceiptHTML — see
  // the comment there.
  const date = dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });
  const time = dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

  const push = (s: string, o: Partial<Directive & { t: "text" }> = {}) =>
    d.push({ t: "text", s, ...o } as Directive);

  // --- header -------------------------------------------------------------
  // Double-width halves the usable columns, so wrap the name accordingly.
  for (const l of wrap(r.orgName, Math.floor(w / 2))) {
    push(l, { align: "center", bold: true, dw: true, dh: true });
  }
  if (r.address) for (const l of wrap(r.address, w)) push(l, { align: "center" });
  if (r.phone) push(r.phone, { align: "center" });
  if (r.vatId) push(`USt-IdNr.: ${r.vatId}`, { align: "center" });
  if (r.taxNumber) push(`Steuernummer: ${r.taxNumber}`, { align: "center" });

  push(rule);
  push("RECHNUNG", { align: "center", bold: true });
  push(rule);

  // --- meta ---------------------------------------------------------------
  push(`Rechnungs-Nr: ${r.receiptNumber}`);
  push(`Bestell-Nr:   ${r.orderNumber}`);
  push(`Datum:        ${date}, ${time}`);
  push(`Art:          ${r.orderTypeLabel}`);
  if (r.guestName) push(`Gast:         ${r.guestName}`);
  push(rule);

  // --- items --------------------------------------------------------------
  for (const l of r.lines) {
    for (const nameLine of wrap(l.name, w)) push(nameLine, { bold: true });
    const left = `${l.qty} x ${money(l.price)}`;
    const right = `${money(l.price * l.qty)}${l.taxLetter ? " " + l.taxLetter : ""}`;
    push(columns(left, right, w));
  }
  push(rule);

  // --- totals -------------------------------------------------------------
  if (r.discount > 0) {
    push(columns("Artikel gesamt", money(r.gross), w));
    push(columns("Rabatt", "-" + money(r.discount), w));
  }
  if (r.tip > 0) push(columns("Trinkgeld", money(r.tip), w));
  push(columns("Summe EUR", money(r.total), w), { bold: true, dh: true });
  push(rule);

  // --- VAT table ----------------------------------------------------------
  // Fixed columns so the figures line up: rate | USt. | Netto | Brutto.
  const c1 = w - 30;
  const cell = (s: string) => s.padStart(10);
  push(`${"USt.%".padEnd(c1)}${cell("USt.")}${cell("Netto")}${cell("Brutto")}`);
  for (const g of r.taxGroups) {
    const label = `${g.letter ? g.letter + " " : ""}${g.rate}%`;
    push(`${label.padEnd(c1)}${cell(money(g.tax))}${cell(money(g.net))}${cell(money(g.gross))}`);
  }
  push(
    `${"Total".padEnd(c1)}${cell(money(r.taxTotal))}${cell(money(r.netTotal))}${cell(
      money(r.netTotal + r.taxTotal),
    )}`,
    { bold: true },
  );
  push(rule);

  // --- footer -------------------------------------------------------------
  push(columns("Zahlungsart", r.paymentLabel, w));
  push("");
  for (const l of wrap("Die Umsatzsteuer ist im ausgewiesenen Betrag enthalten.", w)) push(l);
  // --- TSE ----------------------------------------------------------------
  if (r.tseFailed) {
    push(rule);
    push("Hinweis: TSE-Ausfall - keine Signatur", { bold: true });
  } else if (r.tseQrData || r.tseLines?.length) {
    push(rule);
    if (r.tseQrData) d.push({ t: "qr", data: r.tseQrData });
    for (const l of r.tseLines ?? []) for (const w2 of wrap(l, w)) push(w2);
  }

  push("");
  push("Vielen Dank fuer Ihren Besuch!", { align: "center", bold: true });

  if (r.openDrawer) d.push({ t: "pulse" });
  d.push({ t: "feed", n: 3 });
  d.push({ t: "cut" });
  return d;
}

// ---------------------------------------------------------------------------
// Renderer 1 — raw ESC/POS bytes
// ---------------------------------------------------------------------------
function encodeText(out: number[], s: string) {
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) {
      out.push(code);
      continue;
    }
    const cp = CP858[ch];
    if (cp !== undefined) {
      out.push(cp);
      continue;
    }
    const ascii = ASCII_FALLBACK[ch];
    if (ascii) {
      for (const a of ascii) out.push(a.charCodeAt(0));
      continue;
    }
    out.push(0x3f); // '?'
  }
}

/** Render directives to ESC/POS bytes — for USB, Bluetooth, port 9100, or an agent. */
export function encodeReceipt(r: EscPosReceipt): Uint8Array {
  const b: number[] = [];
  b.push(ESC, 0x40); // initialise
  b.push(ESC, 0x74, 0x13); // select CP858

  let align: Align = "left";
  let bold = false;
  let size = 0;

  for (const dir of buildReceipt(r)) {
    if (dir.t === "feed") {
      b.push(ESC, 0x64, dir.n);
    } else if (dir.t === "cut") {
      b.push(GS, 0x56, 66, 0); // partial cut
    } else if (dir.t === "pulse") {
      // ESC p — the drawer is wired to the printer, not to the computer.
      b.push(ESC, 0x70, 0, 25, 250);
    } else if (dir.t === "qr") {
      // GS ( k — model 2, module size 6, error correction M, then store + print.
      if (align !== "center") {
        b.push(ESC, 0x61, 1);
        align = "center";
      }
      const bytes: number[] = [];
      encodeText(bytes, dir.data);
      const len = bytes.length + 3;
      b.push(GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0); // model 2
      b.push(GS, 0x28, 0x6b, 3, 0, 49, 67, 6); // module size
      b.push(GS, 0x28, 0x6b, 3, 0, 49, 69, 49); // error correction M
      b.push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 49, 80, 48, ...bytes); // store
      b.push(GS, 0x28, 0x6b, 3, 0, 49, 81, 48); // print
    } else {
      const a = dir.align ?? "left";
      if (a !== align) {
        b.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);
        align = a;
      }
      const wantBold = !!dir.bold;
      if (wantBold !== bold) {
        b.push(ESC, 0x45, wantBold ? 1 : 0);
        bold = wantBold;
      }
      const wantSize = ((dir.dw ? 1 : 0) << 4) | (dir.dh ? 1 : 0);
      if (wantSize !== size) {
        b.push(GS, 0x21, wantSize);
        size = wantSize;
      }
      encodeText(b, dir.s);
      b.push(0x0a);
    }
  }
  return new Uint8Array(b);
}

/** Standalone drawer kick, for a "no sale" / open-drawer button. */
export function encodeDrawerKick(): Uint8Array {
  return new Uint8Array([ESC, 0x40, ESC, 0x70, 0, 25, 250]);
}

// ---------------------------------------------------------------------------
// Renderer 2 — ePOS-Print XML (Epson TM printers' built-in web service)
// ---------------------------------------------------------------------------
const EPOS_NS = "http://www.epson-pos.com/schemas/2011/03/epos-print";

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/**
 * Render directives as an ePOS-Print SOAP document. Sent straight to the
 * printer's own web service over HTTP(S) — which means it works from any
 * browser, including iOS, where WebUSB and Web Bluetooth don't exist.
 */
export function buildEposXml(r: EscPosReceipt): string {
  const body: string[] = [];
  for (const dir of buildReceipt(r)) {
    if (dir.t === "feed") {
      body.push(`<feed line="${dir.n}"/>`);
    } else if (dir.t === "cut") {
      body.push(`<cut type="feed"/>`);
    } else if (dir.t === "pulse") {
      body.push(`<pulse drawer="1" time="pulse_100"/>`);
    } else if (dir.t === "qr") {
      body.push(
        `<symbol type="qrcode_model2" level="level_m" width="4" align="center">${xmlEscape(dir.data)}</symbol>`,
      );
    } else {
      const attrs = [
        `align="${dir.align ?? "left"}"`,
        dir.bold ? `em="true"` : "",
        dir.dw ? `dw="true"` : "",
        dir.dh ? `dh="true"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      body.push(`<text ${attrs}>${xmlEscape(dir.s)}&#10;</text>`);
    }
  }

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<s:Body><epos-print xmlns="${EPOS_NS}">` +
    body.join("") +
    `</epos-print></s:Body></s:Envelope>`
  );
}

/** ePOS-Print service endpoint for a printer at `host` (IP or hostname). */
export function eposEndpoint(host: string, useHttps = true): string {
  const scheme = useHttps ? "https" : "http";
  const clean = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `${scheme}://${clean}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
}

export interface EposPrintResult {
  success: boolean;
  code?: string;
  status?: string;
}

/**
 * POST a receipt to an Epson TM printer's ePOS-Print service.
 *
 * Runs in the browser and talks straight to the printer on the local network,
 * so nothing needs installing on the till and no print dialog appears. The
 * printer must have a certificate the browser trusts — see the setup notes in
 * Settings — otherwise the request fails as mixed content.
 */
export async function printViaEpos(
  host: string,
  receipt: EscPosReceipt,
  opts: { useHttps?: boolean; signal?: AbortSignal } = {},
): Promise<EposPrintResult> {
  const res = await fetch(eposEndpoint(host, opts.useHttps ?? true), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
    body: buildEposXml(receipt),
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Printer responded ${res.status}`);
  const xml = await res.text();
  // <response success="true" code="" status="251658262"/>
  const success = /success="true"/.test(xml);
  const code = xml.match(/code="([^"]*)"/)?.[1];
  const status = xml.match(/status="([^"]*)"/)?.[1];
  if (!success) throw new Error(code ? `Printer error: ${code}` : "Printer rejected the job.");
  return { success, code, status };
}
