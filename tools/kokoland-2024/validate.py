#!/usr/bin/env python3
"""Validate the invoice dataset and emit consolidated dashboard_data.json."""
import json, os
from collections import defaultdict

OUT = os.path.join(os.path.dirname(__file__), "out")
def load(n): return json.load(open(os.path.join(OUT, n)))
def num(x): return x if isinstance(x, (int, float)) else 0.0

recs  = load("invoices_all.json")
recon = load("reconciliation.json")
adv   = load("advisor_figures.json")
try: track = load("corrections_tracker.json")
except FileNotFoundError: track = {"workstreams": []}

# ---- 1. per-record validation ----
issues = []
seen_inv = defaultdict(list)
for r in recs:
    f = r.get("file")
    # skip intentionally-excluded docs (non-invoices, duplicates, sales invoices)
    if r.get("is_invoice") is False or r.get("is_duplicate") or r.get("is_sales_invoice"):
        continue
    net, vat, gross, rate = num(r.get("net")), num(r.get("vat_amount")), num(r.get("gross")), num(r.get("vat_rate"))
    if r.get("gross") is None:
        continue
    # gross = net + vat (tol 0.05)
    if abs((net + vat) - gross) > 0.05:
        issues.append(f"SUM  {f}: net {net} + vat {vat} != gross {gross}")
    # vat = net * rate% (tol 0.05) when rate>0 and not §19
    if rate and vat and abs(net * rate / 100 - vat) > 0.06:
        issues.append(f"RATE {f}: net {net} *{rate}% = {round(net*rate/100,2)} != vat {vat}")
    ino = r.get("invoice_no")
    if ino: seen_inv[(r.get("vendor",""), ino)].append(f)

dups = {k: v for k, v in seen_inv.items() if len(v) > 1}

# ---- 2. buckets (mirror build_summary) ----
BLOCKED = {"puneeth", "other_entity"}
def purchase(r):
    return not (r.get("is_sales_invoice") or r.get("is_invoice") is False or r.get("is_duplicate") or r.get("gross") is None)
def bucket(r):
    s = r.get("recipient_status")
    if s in BLOCKED: return "BLOCKED"
    if num(r.get("gross")) <= 250: return "VALID"
    if s == "ok": return "VALID"
    return "AT_RISK"
purchases = [r for r in recs if purchase(r)]
for r in purchases: r["_b"] = bucket(r)

def vsum(b): return round(sum(num(r["vat_amount"]) for r in purchases if r["_b"] == b), 2)
valid, atrisk, blocked = vsum("VALID"), vsum("AT_RISK"), vsum("BLOCKED")
total = round(valid + atrisk + blocked, 2)

# vendor breakdown (VAT)
byvendor = defaultdict(lambda: {"n": 0, "vat": 0.0, "gross": 0.0})
for r in purchases:
    v = byvendor[r.get("vendor", "?")]
    v["n"] += 1; v["vat"] += num(r["vat_amount"]); v["gross"] += num(r["gross"])

# ---- 3. missing invoices (real candidates, named) ----
miss = recon.get("candidate_missing_invoices", [])
def named(m):  # has a real counterparty (not pure card/internal noise)
    c = (m.get("counterparty") or "").lower()
    return c and "card" not in c and not c.startswith("amazon") and "amzn" not in c
missing_named = sorted([m for m in miss if named(m)], key=lambda x: num(x["amount"]))[:25]

data = {
    "generated": __import__("datetime").date.today().isoformat(),
    "advisor": {"input_vat": adv["ust_erklaerung"]["input_vat_total"],
                "output_vat": adv["ust_erklaerung"]["output_vat_total"],
                "refund": adv["ust_erklaerung"]["refund"]},
    "vat": {"valid": valid, "at_risk": atrisk, "blocked": blocked, "total": total,
            "gap": round(adv["ust_erklaerung"]["input_vat_total"] - total, 2)},
    "counts": {"total_docs": len(recs), "purchases": len(purchases),
               "excluded": len(recs) - len(purchases),
               "matched": len(recon.get("matched", [])),
               "unmatched_invoices": len(recon.get("unmatched_invoices", [])),
               "candidate_missing": len(miss),
               "related_party": len(recon.get("related_party_transfers", []))},
    "buckets": {"VALID": len([r for r in purchases if r["_b"]=="VALID"]),
                "AT_RISK": len([r for r in purchases if r["_b"]=="AT_RISK"]),
                "BLOCKED": len([r for r in purchases if r["_b"]=="BLOCKED"])},
    "vendors": sorted([{"vendor": k, "n": v["n"], "vat": round(v["vat"],2), "gross": round(v["gross"],2)}
                       for k, v in byvendor.items()], key=lambda x: -x["vat"])[:18],
    "missing_named": [{"date": m["date"], "amount": round(abs(num(m["amount"])),2),
                       "who": m.get("counterparty","")[:36]} for m in missing_named],
    "corrections": [{"vendor": w["vendor"], "vat": w.get("vat_at_stake",0), "status": w["status"]}
                    for w in track["workstreams"]],
    "validation": {"issues": issues, "duplicate_invoice_nos": [f"{k[0]} {k[1]}: {v}" for k,v in dups.items()]},
}
json.dump(data, open(os.path.join(OUT, "dashboard_data.json"), "w"), ensure_ascii=False, indent=1)

print("="*64)
print("VALIDATION")
print("="*64)
print(f"records: {len(recs)} | purchases: {len(purchases)} | excluded: {len(recs)-len(purchases)}")
print(f"VAT math issues: {len(issues)}")
for i in issues[:20]: print("  !", i)
print(f"duplicate invoice_no (same vendor+no): {len(dups)}")
for k,v in list(dups.items())[:10]: print(f"  ~ {k[0]} {k[1]}: {len(v)} copies")
print()
print(f"VALID {valid} | AT_RISK {atrisk} | BLOCKED {blocked} | TOTAL {total} | advisor {adv['ust_erklaerung']['input_vat_total']} | gap {data['vat']['gap']}")
print("wrote out/dashboard_data.json")
