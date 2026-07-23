# DishData Accounting — German-regulation-grade module

Goal: produce, in-app, everything a Steuerberater produces for a small Gastro company
(UG/GmbH or Einzelunternehmen), while staying legally clean: the tool empowers the
client to do their own books and filings (Eigenleistung — always legal); it does not
file on behalf of third parties (StBerG §5). A DATEV bridge keeps the advisor
workflow alive in parallel ("two tracks").

Battle-tested spec source: the Kokoland 2024 reconstruction + Finanzamt audit
(`tools/kokoland-2024/`). Every compliance rule below was hit in that audit.

## Pillars

1. **Beleg vault (GoBD, §147 AO)** — every document stored as the immutable original
   in the `belege` storage bucket (`org_id/yyyy/uuid.ext`), sha256-hashed, 10-year
   retention. Photos may be compressed client-side; digital PDFs stored byte-exact.
   No update/delete policies on the bucket = write-once for members.
2. **AI extraction + compliance engine** — Claude (Opus 4.8, vision + structured
   outputs) extracts vendor, invoice no, date, per-rate VAT lines, recipient, payment
   method. A pure-TS rules engine then flags:
   - §14 UStG: recipient must be the company when gross > €250
   - §33 UStDV Kleinbetragsrechnung: ≤ €250 valid without recipient name, tax ID, or invoice number
   - §14 Abs. 4 Nr. 2/4 UStG: issuer tax ID and sequential invoice number required above €250
   - §19 UStG conflict: VAT shown by a declared Kleinunternehmer (no deduction)
   - Intra-EU 0% cross-border supply (Art. 138) — no German Vorsteuer
   - §13b UStG domestic reverse charge (Bauleistungen/subcontractors) — recipient self-assesses
   - §4 Abs. 5 Nr. 2 EStG Bewirtung — 70% income-tax cap, 100% Vorsteuer, needs business purpose + attendees
   - §6 Abs. 2 EStG GWG threshold (€800 net) — durable assets above it must be capitalized, not expensed
   - Private-use risk: delivery to a non-business address
   - Large cash payments — Kassenbuch/GwG traceability review
   - Wrong period, duplicates (vendor + invoice no), non-standard VAT rate, malformed VAT-ID format
   Every invoice lands in a bucket: `valid` | `at_risk` | `blocked` | `no_vat` | `review`.
   Bewirtung/GWG flags affect GuV/Bilanz treatment, not VAT deductibility — they never change the bucket.
3. **Bank reconciliation** — CSV import (Vivid format proven; FinTS/GoCardless later),
   invoice↔payment matching, missing-Beleg detection, related-party flagging.
   The FA rule: every bank line on every account needs a Beleg.
4. **Ledger** — double-entry journal on SKR03 (DATEV chart). Posting rules learn
   vendor→account mappings. POS Z-reports auto-post daily revenue with the gastro
   7% (outside) / 19% (in-house) split; Kassenbuch from POS data (TSE/KassenSichV).
5. **VAT engine** — UStVA (monthly/quarterly) computed from the journal;
   Kleinunternehmer handling; annual USt-Erklärung figures. Export for ELSTER
   upload first; ERiC direct submission later.
6. **Year-end documents** — EÜR (small clients) or Bilanz + GuV (HGB
   Kleinstkapitalgesellschaft §267a relief) + Anhang; KSt/GewSt prep sheets;
   E-Bilanz XBRL later; Offenlegung Unternehmensregister.
7. **DATEV bridge** — Buchungsstapel (EXTF CSV) + Beleg export so an advisor can
   review/file; this is what shrinks the advisor's bookkeeping fee.
8. **Audit mode** — per-bank-line Beleg index, findings report, corrections tracker
   (the exact artifacts the Finanzamt demanded from Kokoland).

## Phases

- **Phase 1 (this code)**: schema (0012), Beleg vault, extraction API, review queue
  UI with compliance flags + VAT buckets. End-to-end: photo/PDF → stored original →
  extracted row → flagged → reviewed.
- **Phase 2**: bank CSV import + reconciliation + Z-report revenue posting + Kassenbuch.
- **Phase 3**: SKR03 posting rules + journal automation + UStVA generation + DATEV export.
- **Phase 4**: EÜR / Bilanz + GuV + Anhang, KSt/GewSt prep, E-Bilanz.
- **Phase 5**: ERiC/ELSTER direct filing; E-Rechnung (XRechnung/ZUGFeRD) ingestion + issuance.

## Files

- `types.ts` — shared types + the pure compliance/bucket engine (unit-testable)
- `extract.ts` — server-only Claude extraction (`@anthropic-ai/sdk`)
- `../api/accounting.ts` — client API (upload → storage + row + extract call)
- `../../app/api/accounting/extract/route.ts` — authenticated extraction endpoint
- `../../../supabase/migrations/0012_accounting_core.sql` — tables, RLS, bucket, SKR03 seed
- `../../../supabase/migrations/0013_accounting_compliance_extensions.sql` — reverse_charge_domestic/is_bewirtung/asset_like columns
