#!/usr/bin/env python3
"""
Rebuild the bank ledger from Vivid's clean full-year 2024 CSV exports (semicolon
delimited, with Card + running balance). These are more complete than the original
parse (they include the SEPA direct debits, SEV rent, etc.).

Strategy: take Vivid Main + Vivid Second 2024 rows from the clean CSVs; keep Vivid
Interest + Qonto from the existing ledger (CSV Interest schema differs; Qonto is a
separate bank). Back up the old ledger first.
"""
import csv, json, os, datetime as dt

OUT = os.path.join(os.path.dirname(__file__), "out")
CSVDIR = "/Users/sonythellappillyskariah/Downloads/Vivid statements 2023-12-01 - 2024-12-31"

ACCT = {
    "DE23202208000026634695": "Vivid Main (…4695)",
    "DE38202208000027720049": "Vivid Second (…0049)",
}
FILES = {
    "Vivid Main (…4695)":  "Statement DE23202208000026634695 2024-05-20 - 2024-12-31.csv",
    "Vivid Second (…0049)": "Statement DE38202208000027720049 2024-07-25 - 2024-12-31.csv",
}

def isodate(s):           # DD-MM-YYYY -> YYYY-MM-DD
    d, m, y = s.split("-")
    return f"{y}-{m}-{d}"

def parse_csv(account, path):
    out = []
    for r in csv.DictReader(open(path), delimiter=";"):
        date = r.get("Completed date") or ""
        if not date.endswith("-2024"):
            continue
        amt = float(r.get("Payment amount") or 0)
        cp = (r.get("Counterparty name") or "").strip()
        ref = (r.get("Reference") or "").strip()
        ttype = (r.get("Transaction type") or "").strip()
        card = (r.get("Card") or "").strip()
        desc = " ".join(x for x in [cp, ref, f"[{ttype}]" if ttype else "", f"Card {card}" if card else ""] if x)
        out.append({
            "source": "vivid_csv",
            "account": account,
            "date": isodate(date),
            "type": "incoming" if amt > 0 else "outgoing",
            "amount": round(amt, 2),
            "counterparty": cp or ref or ttype,
            "description": desc,
            "balance": float(r["Running balance amount"]) if r.get("Running balance amount") else None,
            "vat_amount": None,
            "ref": ref,
            "txn_id": None,
            "category": ttype.lower(),
            "card": card or None,
            "has_attachment": False,
        })
    return out

def main():
    old = json.load(open(os.path.join(OUT, "bank_ledger.json")))
    # back up
    json.dump(old, open(os.path.join(OUT, "bank_ledger_ORIG.json"), "w"), ensure_ascii=False, indent=1)

    # keep Interest + Qonto from original; rebuild Main + Second from clean CSV
    kept = [r for r in old if not (r["account"].startswith("Vivid Main") or r["account"].startswith("Vivid Second"))]
    rebuilt = []
    for acct, fn in FILES.items():
        rows = parse_csv(acct, os.path.join(CSVDIR, fn))
        rebuilt += rows
        # validate closing balance (last row by date)
        if rows:
            last = sorted(rows, key=lambda x: x["date"])[-1]
            print(f"{acct}: {len(rows)} rows, last balance {last['balance']}")

    ledger = kept + rebuilt
    ledger.sort(key=lambda x: x["date"])
    json.dump(ledger, open(os.path.join(OUT, "bank_ledger.json"), "w"), ensure_ascii=False, indent=1)
    print(f"\nrebuilt ledger: {len(ledger)} rows ({len(kept)} kept Interest/Qonto + {len(rebuilt)} clean Vivid Main/Second)")
    print("backup saved to bank_ledger_ORIG.json")

if __name__ == "__main__":
    main()
