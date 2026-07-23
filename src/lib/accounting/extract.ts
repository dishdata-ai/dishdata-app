import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedInvoice } from "./types";

// Structured-output schema for German invoice extraction. Every rule here was
// battle-tested on the Kokoland 2024 audit corpus (thermal receipts, BAR
// invoices, Amazon marketplace PDFs, EU 0% supplies, §19 contractors).
const nullable = (t: "string" | "number") => ({ anyOf: [{ type: t }, { type: "null" }] });

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_invoice", "document_kind", "direction", "vendor_name", "vendor_vat_id",
    "invoice_no", "invoice_date", "service_date", "currency", "vat_lines",
    "total_net", "total_vat", "gross", "recipient_name", "recipient_is_org",
    "recipient_status", "delivery_address", "delivery_looks_private",
    "payment_method", "seller_kleinunternehmer", "eu_zero_rated", "reverse_charge_domestic",
    "is_bewirtung", "asset_like", "category", "notes",
  ],
  properties: {
    is_invoice: { type: "boolean", description: "true only for a Rechnung/Kassenbon/Quittung with amounts; false for Angebot, Lieferschein, Auftragsbestätigung, Proforma, statements" },
    document_kind: { type: "string", enum: ["rechnung", "kassenbon", "quittung", "angebot", "lieferschein", "auftragsbestaetigung", "proforma", "gutschrift", "other"] },
    direction: { type: "string", enum: ["purchase", "sale"], description: "sale when the ORG ITSELF issued this invoice to a customer" },
    vendor_name: { type: "string" },
    vendor_vat_id: nullable("string"),
    invoice_no: nullable("string"),
    invoice_date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    service_date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    currency: { type: "string" },
    vat_lines: {
      type: "array",
      description: "One entry per VAT rate on the document (0, 7, 19). Gutschrift/return: negative amounts.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rate", "net", "vat"],
        properties: { rate: { type: "number" }, net: { type: "number" }, vat: { type: "number" } },
      },
    },
    total_net: { type: "number" },
    total_vat: { type: "number" },
    gross: { type: "number" },
    recipient_name: nullable("string"),
    recipient_is_org: { type: "boolean" },
    recipient_status: {
      type: "string",
      enum: ["ok", "none", "third_party", "review"],
      description: "ok = the org is the named invoice recipient; none = no recipient printed (typical Kassenbon); third_party = a DIFFERENT person/company is the billed recipient; review = unclear",
    },
    delivery_address: nullable("string"),
    delivery_looks_private: { type: "boolean", description: "true when delivery goes to a residential/personal address that is not the org's business address" },
    payment_method: { type: "string", enum: ["card", "cash", "transfer", "direct_debit", "unknown"] },
    seller_kleinunternehmer: { type: "boolean", description: "true when the document cites §19 UStG / Kleinunternehmerregelung" },
    eu_zero_rated: { type: "boolean", description: "true for steuerfreie innergemeinschaftliche Lieferung (Art. 138 EU cross-border) — 0% VAT with a foreign VAT-ID on the invoice" },
    reverse_charge_domestic: { type: "boolean", description: "true for DOMESTIC reverse charge (§13b UStG) — e.g. 'Steuerschuldnerschaft des Leistungsempfängers' on a Bauleistung/subcontractor/cleaning invoice between two German businesses. Distinct from eu_zero_rated (cross-border)." },
    is_bewirtung: { type: "boolean", description: "true when this documents hosting a business partner/client/customer at a restaurant or café (Bewirtungsbeleg) — not a routine staff meal or supply purchase" },
    asset_like: { type: "boolean", description: "true when the purchase is durable equipment, furniture, machinery, or kitchen appliances intended for multi-year use, as opposed to a consumable, ingredient, or one-off service" },
    category: { type: "string", description: "short expense category, e.g. 'Food & Beverage', 'Build materials', 'Legal', 'Equipment', 'Rent', 'Insurance'" },
    notes: { type: "string", description: "anything a bookkeeper must know: BAR/cash markers, card last4, Skonto, project references, anomalies" },
  },
} as const;

const SYSTEM_PROMPT = `You are the document-extraction engine of a German restaurant accounting system (GoBD/UStG compliant). You read supplier invoices, thermal Kassenbons, Quittungen, and PDFs — often crumpled, faded, or photographed — and produce exact structured data.

Rules learned from real Finanzamt audits:
- Read amounts from the printed totals; never recompute them. Per-rate VAT lines (MWST-CODE blocks, "USt. 19%" tables) are authoritative.
- The RECIPIENT is whoever is named in the address/Anschrift block. A company mentioned only in the body (e.g. "BV: <company>" as a project reference, or "Im Auftrag für") does NOT make it the recipient — that is third_party if a different party is billed.
- Kassenbons usually have no recipient (recipient_status = "none"). An empty "Empfänger/Kunde ___" line is "none".
- "Barverkauf"/"BAR" = cash unless an EC/card block (card number, TSE "Unbar") shows otherwise.
- Amazon marketplace invoices: the seller ("Verkauft von") is the vendor, not Amazon; the Geschäftsadresse block is the recipient; a Lieferadresse differing from the business address matters.
- "Steuerfreie innergemeinschaftliche Lieferung – Artikel 138" or foreign VAT-IDs with 0% ⇒ eu_zero_rated = true, vat = 0.
- "Steuerschuldnerschaft des Leistungsempfängers" / "§13b UStG" between two domestic businesses (common on Bauleistungen, subcontracted construction, cleaning, security) ⇒ reverse_charge_domestic = true, vat = 0. Do NOT set eu_zero_rated for this — they are different legal categories.
- §19 UStG notes ("keine Umsatzsteuer erhoben") ⇒ seller_kleinunternehmer = true even if a VAT line is (wrongly) printed.
- A restaurant/café receipt where the company is hosting a customer, supplier, or business partner (not staff eating on shift) ⇒ is_bewirtung = true.
- Durable equipment, furniture, kitchen machinery, POS hardware, tools meant for multi-year use ⇒ asset_like = true; ordinary stock, ingredients, and services are not asset_like.
- Angebot, Lieferschein, Auftragsbestätigung, Proforma ⇒ is_invoice = false.
- Gutschrift / Warenrücknahme ⇒ negative amounts.
- If the org itself is the ISSUER (its name/IBAN in the letterhead, "Bill to" someone else) ⇒ direction = "sale".`;

export interface ExtractInput {
  bytes: Buffer;
  mimeType: string;
  orgName: string;
  orgAddress?: string | null;
  orgVatId?: string | null;
}

const MODEL = "claude-opus-4-8";

/** Extract structured invoice data from a document (PDF or image) via Claude vision. */
export async function extractInvoice(input: ExtractInput): Promise<ExtractedInvoice> {
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env

  const base64 = input.bytes.toString("base64");
  const isPdf = input.mimeType === "application/pdf";
  const mediaBlock = isPdf
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(input.mimeType)
            ? input.mimeType
            : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64,
        },
      };

  const orgIdentity = [
    `Company (the org): ${input.orgName}`,
    input.orgAddress ? `Business address: ${input.orgAddress}` : null,
    input.orgVatId ? `USt-IdNr: ${input.orgVatId}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          mediaBlock,
          {
            type: "text",
            text: `${orgIdentity}\n\nExtract this document. Determine recipient_status relative to the company above (name variants and obvious misspellings of the company still count as "ok").`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Extraction was declined by the model's safety system.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No structured output returned from extraction.");
  }
  const parsed = JSON.parse(textBlock.text) as ExtractedInvoice;
  return parsed;
}

export const EXTRACTION_MODEL = MODEL;
