// Shared accounting types + the pure compliance engine.
// Client-safe (no server imports). Rules sourced from the Kokoland 2024 Finanzamt
// audit — each flag corresponds to a point the FA actually raised.

export interface VatLine {
  rate: number; // 0 | 7 | 19
  net: number;
  vat: number;
}

export type RecipientStatus = "ok" | "none" | "third_party" | "review";
export type InvoiceBucket = "valid" | "at_risk" | "blocked" | "no_vat" | "review";
export type InvoiceStatus = "needs_review" | "confirmed" | "excluded";

export interface ComplianceFlag {
  code: string;
  severity: "info" | "warn" | "block";
  message: string;
}

/** Shape returned by the Claude extraction (mirrors output schema in extract.ts). */
export interface ExtractedInvoice {
  is_invoice: boolean;
  document_kind: string; // rechnung | kassenbon | quittung | angebot | lieferschein | auftragsbestaetigung | other
  direction: "purchase" | "sale";
  vendor_name: string;
  vendor_vat_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null; // YYYY-MM-DD
  service_date: string | null;
  currency: string;
  vat_lines: VatLine[];
  total_net: number;
  total_vat: number;
  gross: number;
  recipient_name: string | null;
  recipient_is_org: boolean; // invoice recipient block names the org
  recipient_status: RecipientStatus;
  delivery_address: string | null;
  delivery_looks_private: boolean;
  payment_method: string; // card | cash | transfer | direct_debit | unknown
  seller_kleinunternehmer: boolean; // §19 UStG note present
  eu_zero_rated: boolean; // steuerfreie innergemeinschaftliche Lieferung (cross-border, Art. 138)
  reverse_charge_domestic: boolean; // §13b UStG domestic reverse charge (Bauleistungen etc.)
  is_bewirtung: boolean; // Bewirtungsbeleg — hosting a business partner
  asset_like: boolean; // durable equipment/furniture candidate for capitalization (GWG/AfA)
  category: string;
  notes: string;
}

export interface AcctInvoice extends Record<string, unknown> {
  id: string;
  org_id: string;
  document_id: string | null;
  direction: string;
  vendor_name: string;
  vendor_vat_id: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  currency: string;
  vat_lines: VatLine[];
  total_net: number;
  total_vat: number;
  gross: number;
  recipient_status: RecipientStatus;
  payment_method: string | null;
  seller_kleinunternehmer: boolean;
  eu_zero_rated: boolean;
  reverse_charge_domestic: boolean;
  is_bewirtung: boolean;
  asset_like: boolean;
  category: string;
  compliance_flags: ComplianceFlag[];
  bucket: InvoiceBucket;
  status: InvoiceStatus;
  notes: string | null;
  created_at: string;
  /** Embedded from acct_documents when listed via the API. */
  document?: { storage_path: string; original_filename: string } | null;
}

export interface AcctDocument {
  id: string;
  org_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  source: string;
  created_at: string;
}

/** §33 UStDV small-amount invoice threshold (gross, EUR). */
export const KLEINBETRAG_LIMIT = 250;

/** §6 Abs. 2 EStG geringwertiges Wirtschaftsgut threshold (net, EUR) — above this, capitalize + depreciate. */
export const GWG_LIMIT = 800;

/** Cash payments above this are flagged for Kassenbuch/GwG traceability review (no statutory cap, audit heuristic). */
export const LARGE_CASH_THRESHOLD = 1000;

/**
 * The compliance engine. Pure function: extraction result + fiscal year →
 * flags + bucket. Mirrors tools/kokoland-2024/build_summary.py `bucket()`.
 */
export function evaluateCompliance(
  x: ExtractedInvoice,
  opts: { fiscalYear?: number } = {},
): { flags: ComplianceFlag[]; bucket: InvoiceBucket } {
  const flags: ComplianceFlag[] = [];

  // Non-invoices (quotes, delivery notes, order confirmations) never carry VAT rights.
  if (!x.is_invoice) {
    flags.push({
      code: "not_an_invoice",
      severity: "block",
      message: `Document is a ${x.document_kind}, not a Rechnung — no Vorsteuer, keep for reference only.`,
    });
    return { flags, bucket: "review" };
  }

  if (x.direction === "sale") {
    flags.push({
      code: "sales_invoice",
      severity: "info",
      message: "Outgoing invoice — belongs to revenue / output VAT, not input VAT.",
    });
    return { flags, bucket: "no_vat" };
  }

  // §19 conflict: VAT shown by a Kleinunternehmer is not deductible (FA point 6).
  if (x.seller_kleinunternehmer && x.total_vat > 0) {
    flags.push({
      code: "s19_conflict",
      severity: "block",
      message:
        "Invoice shows VAT but also cites §19 UStG (Kleinunternehmer) — defective, VAT not deductible. Request a corrected invoice.",
    });
  }

  // Intra-EU 0% cross-border supply: no German input VAT (correct, not an error).
  if (x.eu_zero_rated) {
    flags.push({
      code: "eu_zero_rated",
      severity: "info",
      message: "Steuerfreie innergemeinschaftliche Lieferung (Art. 138) — no German Vorsteuer on this document.",
    });
  }

  // Domestic reverse charge (§13b UStG, e.g. Bauleistungen): recipient self-assesses the VAT.
  if (x.reverse_charge_domestic) {
    flags.push({
      code: "reverse_charge_domestic",
      severity: "info",
      message:
        "Steuerschuldnerschaft des Leistungsempfängers (§13b UStG) — self-assess this VAT in the UStVA (output + input, net-zero if fully deductible); the vendor correctly charges no VAT.",
    });
  }

  // §14 recipient rules (FA points 5, 8, 9).
  const isKleinbetrag = x.gross > 0 && x.gross <= KLEINBETRAG_LIMIT;

  // §14 Abs. 4 Nr. 2 UStG: issuer's tax number/USt-IdNr is mandatory above Kleinbetrag.
  if (!isKleinbetrag && !x.vendor_vat_id) {
    flags.push({
      code: "missing_vendor_tax_id",
      severity: "warn",
      message: `No USt-IdNr/Steuernummer captured for ${x.vendor_name || "the vendor"} — §14 Abs. 4 UStG requires the issuer's tax ID above ${KLEINBETRAG_LIMIT} €. Check the original for a Steuernummer.`,
    });
  } else if (x.vendor_vat_id && !/^[A-Za-z]{2}[0-9A-Za-z]{2,12}$/.test(x.vendor_vat_id.replace(/\s/g, ""))) {
    flags.push({
      code: "malformed_vat_id",
      severity: "info",
      message: `Vendor VAT ID "${x.vendor_vat_id}" doesn't match the standard EU format (2-letter country code + digits) — verify extraction.`,
    });
  }

  // §14 Abs. 4 Nr. 4 UStG: sequential invoice number is mandatory above Kleinbetrag.
  if (!isKleinbetrag && !x.invoice_no) {
    flags.push({
      code: "missing_invoice_number",
      severity: "warn",
      message: `No Rechnungsnummer captured — §14 Abs. 4 Nr. 4 UStG requires a unique invoice number above ${KLEINBETRAG_LIMIT} €.`,
    });
  }
  if (x.recipient_status === "third_party") {
    flags.push({
      code: "wrong_recipient",
      severity: "block",
      message: `Invoice is addressed to "${x.recipient_name ?? "another party"}" — no Vorsteuer until reissued to the company.`,
    });
  } else if (!isKleinbetrag && x.gross > KLEINBETRAG_LIMIT && x.recipient_status !== "ok") {
    flags.push({
      code: "s14_recipient_missing",
      severity: "warn",
      message: `Gross ${x.gross.toFixed(2)} € > ${KLEINBETRAG_LIMIT} € requires the company as named recipient (§14 UStG). Obtain a compliant document.`,
    });
  } else if (isKleinbetrag && x.recipient_status !== "ok") {
    flags.push({
      code: "kleinbetrag_ok",
      severity: "info",
      message: `≤ ${KLEINBETRAG_LIMIT} € — Kleinbetragsrechnung (§33 UStDV), recipient name not required.`,
    });
  }

  // Private-use risk (FA point 7 pattern: delivery to a shareholder's home).
  if (x.delivery_looks_private) {
    flags.push({
      code: "private_use_risk",
      severity: "warn",
      message: "Delivered to a private / non-business address — verify business purpose before deducting.",
    });
  }

  // Period check.
  if (opts.fiscalYear && x.invoice_date) {
    const y = Number(x.invoice_date.slice(0, 4));
    if (y !== opts.fiscalYear) {
      flags.push({
        code: "wrong_period",
        severity: "warn",
        message: `Invoice dated ${x.invoice_date} is outside fiscal year ${opts.fiscalYear}.`,
      });
    }
  }

  // VAT arithmetic sanity (tolerance 5 cents for per-line rounding).
  const sumNet = x.vat_lines.reduce((s, l) => s + l.net, 0);
  const sumVat = x.vat_lines.reduce((s, l) => s + l.vat, 0);
  if (x.gross > 0 && Math.abs(sumNet + sumVat - x.gross) > 0.05) {
    flags.push({
      code: "vat_math",
      severity: "warn",
      message: `net + VAT (${(sumNet + sumVat).toFixed(2)}) ≠ gross (${x.gross.toFixed(2)}) — verify amounts.`,
    });
  }

  // Non-standard VAT rate — either an extraction error or a genuine invoice defect.
  if (x.vat_lines.some((l) => l.net !== 0 && ![0, 7, 19].includes(l.rate))) {
    flags.push({
      code: "unusual_vat_rate",
      severity: "warn",
      message: "A VAT rate other than 0/7/19% was recorded — verify extraction or check for a stale/foreign rate.",
    });
  }

  // Bewirtung (§4 Abs. 5 Nr. 2 EStG): VAT stays fully deductible, but only 70% is deductible
  // for corporate income tax, and the receipt must show business purpose + attendees.
  if (x.is_bewirtung) {
    flags.push({
      code: "bewirtung_cap",
      severity: "warn",
      message:
        "Bewirtungsbeleg (§4 Abs. 5 Nr. 2 EStG): only 70% deductible for corporate income tax (Vorsteuer stays 100% deductible). Note the business purpose and attendee names on the receipt.",
    });
  }

  // GWG threshold (§6 Abs. 2 EStG): durable assets above the net limit must be capitalized and
  // depreciated (AfA), not expensed immediately — the same Erhaltungsaufwand-vs-Herstellungskosten
  // distinction the FA raised on the 2024 renovation.
  if (x.asset_like && x.total_net > GWG_LIMIT) {
    flags.push({
      code: "capitalize_asset",
      severity: "warn",
      message: `Net ${x.total_net.toFixed(2)} € exceeds the ${GWG_LIMIT} € GWG limit (§6 Abs. 2 EStG) — capitalize as Anlagevermögen and depreciate (AfA) instead of expensing immediately.`,
    });
  }

  // Large cash payment: audit-trail / GwG traceability, not a VAT-validity issue.
  if (x.payment_method === "cash" && x.gross > LARGE_CASH_THRESHOLD) {
    flags.push({
      code: "large_cash_payment",
      severity: "warn",
      message: `Cash payment of ${x.gross.toFixed(2)} € — confirm it is recorded in the Kassenbuch same-day and the cash origin is traceable.`,
    });
  }

  // Bucket derivation (same precedence as the Kokoland engine).
  let bucket: InvoiceBucket;
  if (flags.some((f) => f.severity === "block")) bucket = "blocked";
  else if (x.total_vat === 0) bucket = "no_vat";
  else if (
    flags.some(
      (f) => f.code === "s14_recipient_missing" || f.code === "missing_vendor_tax_id" || f.code === "missing_invoice_number",
    )
  )
    bucket = "at_risk";
  else if (
    flags.some(
      (f) =>
        f.code === "private_use_risk" ||
        f.code === "wrong_period" ||
        f.code === "vat_math" ||
        f.code === "unusual_vat_rate" ||
        f.code === "large_cash_payment",
    )
  )
    bucket = "review";
  else bucket = "valid";

  return { flags, bucket };
}

/** Aggregate VAT by bucket for the dashboard cards. */
export function vatSummary(invoices: AcctInvoice[]) {
  const sums = { valid: 0, at_risk: 0, blocked: 0, no_vat: 0, review: 0, total: 0 };
  for (const inv of invoices) {
    if (inv.status === "excluded") continue;
    const v = Number(inv.total_vat) || 0;
    sums[inv.bucket] += v;
    sums.total += v;
  }
  return sums;
}
