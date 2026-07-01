#!/usr/bin/env python3
"""
Consolidate all extracted Kokoland 2024 supplier invoices into one ledger and
produce a Vorsteuer (input-VAT) summary + findings.

Inputs:
  out/invoices/W*.json   (per-week scanned receipts)
  out/invoices_text.json (digital text bills)

Outputs:
  out/invoices_all.json  (one consolidated, normalized list)
  stdout summary         (VAT split valid vs blocked, compliance findings)
"""
import json, glob, os
from collections import defaultdict

OUT = os.path.join(os.path.dirname(__file__), "out")

def load_all():
    recs = []
    # per-week scans (W*.json) plus any INTAKE.json of later-found invoices
    for fp in sorted(glob.glob(os.path.join(OUT, "invoices", "W*.json"))
                     + glob.glob(os.path.join(OUT, "invoices", "INTAKE*.json"))
                     + glob.glob(os.path.join(OUT, "invoices", "AMAZON*.json"))):
        with open(fp) as f:
            recs.extend(json.load(f))
    with open(os.path.join(OUT, "invoices_text.json")) as f:
        recs.extend(json.load(f))
    return recs

def num(x):
    return x if isinstance(x, (int, float)) else 0.0

def main():
    recs = load_all()

    # Classify every record
    purchases = []      # count toward input VAT
    excluded = []       # sales invoice / not-an-invoice / duplicate / wrong period
    for r in recs:
        if r.get("is_sales_invoice"):
            r["_excl"] = "sales_invoice (output VAT, not input)"
            excluded.append(r); continue
        if r.get("is_invoice") is False:
            r["_excl"] = "not a valid invoice (quote/order-confirm/delivery-note/label)"
            excluded.append(r); continue
        if r.get("is_duplicate"):
            r["_excl"] = "duplicate"
            excluded.append(r); continue
        if r.get("gross") is None:           # e.g. wrong-period obi with null values
            r["_excl"] = "no usable amounts (excluded, e.g. wrong period)"
            excluded.append(r); continue
        purchases.append(r)

    # VAT split by recipient_status
    by_status = defaultdict(lambda: {"n": 0, "net": 0.0, "vat": 0.0, "gross": 0.0})
    for r in purchases:
        s = r.get("recipient_status", "review")
        b = by_status[s]
        b["n"] += 1
        b["net"]   += num(r.get("net"))
        b["vat"]   += num(r.get("vat_amount"))
        b["gross"] += num(r.get("gross"))

    # Correct German Vorsteuer rule applied per record:
    #   - puneeth / other_entity      -> BLOCKED (wrong recipient on a >250 doc)
    #   - gross <= 250 (any status)   -> VALID (Kleinbetragsrechnung, recipient name not required)
    #   - status ok (named, any amt)  -> VALID
    #   - gross > 250 & not named     -> AT_RISK (§14 gap: claim only after obtaining a compliant doc)
    BLOCKED = {"puneeth", "other_entity"}
    def bucket(r):
        s = r.get("recipient_status")
        if s in BLOCKED:
            return "blocked"
        if num(r.get("gross")) <= 250:
            return "valid"
        if s == "ok":
            return "valid"
        return "at_risk"     # gross>250 with status none/review

    for r in purchases:
        r["_bucket"] = bucket(r)
    valid_vat   = sum(num(r.get("vat_amount")) for r in purchases if r["_bucket"] == "valid")
    blocked_vat = sum(num(r.get("vat_amount")) for r in purchases if r["_bucket"] == "blocked")
    atrisk_vat  = sum(num(r.get("vat_amount")) for r in purchases if r["_bucket"] == "at_risk")
    review_vat  = atrisk_vat
    total_vat   = valid_vat + blocked_vat + atrisk_vat

    # §14 compliance gaps = the at_risk bucket
    gaps = [r for r in purchases if r["_bucket"] == "at_risk"]

    # Write consolidated ledger
    with open(os.path.join(OUT, "invoices_all.json"), "w") as f:
        json.dump(recs, f, ensure_ascii=False, indent=1)

    # ---- report ----
    def eur(x): return f"{x:>12,.2f}"
    print("=" * 70)
    print("KOKOLAND 2024 — SUPPLIER INVOICE / VORSTEUER SUMMARY")
    print("=" * 70)
    print(f"Total documents read         : {len(recs)}")
    print(f"  counted as purchases       : {len(purchases)}")
    print(f"  excluded (sales/dup/etc.)  : {len(excluded)}")
    print()
    print("Purchases by recipient_status:")
    print(f"  {'status':<14}{'n':>4}{'net':>14}{'VAT':>14}{'gross':>14}")
    for s in sorted(by_status):
        b = by_status[s]
        print(f"  {s:<14}{b['n']:>4}{eur(b['net'])}{eur(b['vat'])}{eur(b['gross'])}")
    print()
    print("INPUT VAT (Vorsteuer) split — correct §14 rule applied per document:")
    print(f"  VALID now (named recipient, or <=250 Kleinbetrag) : {eur(valid_vat)}")
    print(f"  AT RISK (>250 & no named recipient, §14 gap)      : {eur(atrisk_vat)}   <- claim after obtaining compliant doc")
    print(f"  BLOCKED (billed to Puneeth/other entity)          : {eur(blocked_vat)}   <- recover by re-billing to Kokoland")
    print(f"  {'-'*58}")
    print(f"  TOTAL input VAT across all purchases              : {eur(total_vat)}")
    print(f"  (theoretical max recoverable if all fixed         : {eur(total_vat)})")
    print()
    print(f"§14 compliance gaps (gross > 250 EUR, no named recipient): {len(gaps)}")
    for r in sorted(gaps, key=lambda x: -num(x.get("gross"))):
        print(f"   {r['date']}  {num(r['gross']):>9,.2f}  VAT {num(r['vat_amount']):>8,.2f}  {r['vendor'][:32]:<32} [{r['recipient_status']}]")
    print()
    print("BLOCKED invoices (wrong recipient — Vorsteuer at risk):")
    for r in sorted([p for p in purchases if p.get('recipient_status') in BLOCKED], key=lambda x: -num(x.get('vat_amount'))):
        print(f"   {r['date']}  VAT {num(r['vat_amount']):>8,.2f}  {r['vendor'][:30]:<30} [{r['recipient_status']}]  {r['file'][:40]}")

if __name__ == "__main__":
    main()
