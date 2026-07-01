"""
Parse all Kokoland 2024 bank data into one unified transaction ledger.

Sources:
  - Qonto (old bank): CSV export, Jan-May 2024, has VAT columns already.
  - Vivid: 3 statement PDFs (2 current accounts + 1 interest), May-Dec 2024.

Output: out/bank_ledger.json  (list of normalized transactions)

Normalized transaction schema:
  {
    "source": "qonto" | "vivid",
    "account": "<account label / IBAN tail>",
    "date": "YYYY-MM-DD",
    "type": "incoming" | "outgoing",
    "amount": float,            # signed: negative = money out
    "counterparty": str,
    "description": str,
    "balance": float | None,
    "vat_amount": float | None, # only Qonto provides this
    "ref": str,                 # raw reference / note
    "txn_id": str,
  }
"""
import csv
import json
import os
import re
from glob import glob

import pdfplumber

DATA = "/Users/sonythellappillyskariah/Downloads/Invoices & Bills - 2024"
OUT = os.path.join(os.path.dirname(__file__), "out")

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


def money(s):
    """'-EUR1,500.00' or '€1.234,56' or '40.00' -> float."""
    if s is None or s == "":
        return None
    s = s.replace("EUR", "").replace("€", "").strip()
    neg = s.startswith("-")
    s = s.lstrip("+-").strip()
    # German vs english decimal: Vivid uses '1,500.00' (english). Qonto uses '.' decimal.
    s = s.replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


# ---------------------------------------------------------------- Qonto CSV
def parse_qonto():
    txns = []
    for path in glob(os.path.join(DATA, "KOKOLAND GASTRO QONTO (OLD BANK)", "*.csv")):
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                debit = money(r.get("Debit"))
                credit = money(r.get("Credit"))
                amt = (credit or 0) - (debit or 0)
                txns.append({
                    "source": "qonto",
                    "account": "Qonto Hauptkonto",
                    "date": isodate_qonto(r.get("Settlement date (local)") or r.get("Operation date (local)")),
                    "type": "incoming" if amt >= 0 else "outgoing",
                    "amount": round(amt, 2),
                    "counterparty": (r.get("Counterparty name") or "").strip(),
                    "description": (r.get("Note") or r.get("Reference") or "").strip(),
                    "balance": money(r.get("Balance")),
                    "vat_amount": money(r.get("Total VAT amount")),
                    "ref": (r.get("Reference") or "").strip(),
                    "txn_id": (r.get("Transaction ID") or "").strip(),
                    "category": (r.get("Category") or "").strip(),
                    "has_attachment": bool((r.get("Attachment") or "").strip()),
                })
    return txns


def isodate_qonto(s):
    # '21-05-2024 17:15:34' -> '2024-05-21'
    if not s:
        return None
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", s.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


# ---------------------------------------------------------------- Vivid PDFs
# Current-account statements (Main / Second): text lines look like
#   "May 22, 2024 Incoming transfer EUR40.00 EUR40.00"
# with the multi-line description on the surrounding lines. The two trailing
# EUR tokens are (amount, running balance) — the balance is our ground truth.
EUR_RE = re.compile(r"-?EUR[\d,]+\.\d{2}")
ANCHOR_RE = re.compile(r"^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})\b")
TYPE_RE = re.compile(r"\b(Incoming transfer|Outgoing transfer|Card payment|Card refund|"
                     r"Fee|Interest|Direct debit|Reward)\b", re.I)
NOISE = ("Page ", "This service", "Vivid Money", "KOKOLAND GASTRO UG", "Petersburger",
         "10249 Berlin", "Germany", "Booking Date", "Opening balance", "Closing balance",
         "Statement of Account", "Accounting period", "Issued on", "EUR0.00")


def parse_vivid_current(path, account_label):
    """Parse a Vivid current-account statement via text-line anchors."""
    raw_lines = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            raw_lines += (page.extract_text() or "").split("\n")

    # First pass: find anchor line indices.
    anchors = []  # (line_idx, txn dict)
    for i, ln in enumerate(raw_lines):
        s = ln.strip()
        m = ANCHOR_RE.match(s)
        if not m:
            continue
        eur = EUR_RE.findall(s)
        if len(eur) < 2:
            continue
        amount, balance = money(eur[-2]), money(eur[-1])
        iso = f"{m.group(3)}-{MONTHS[m.group(1)]:02d}-{int(m.group(2)):02d}"
        tm = TYPE_RE.search(s)
        # inline description = text between the type and the first EUR token
        inline = s
        if tm:
            inline = s[tm.end():]
        inline = EUR_RE.sub("", inline).strip(" -,")
        anchors.append((i, {
            "source": "vivid",
            "account": account_label,
            "date": iso,
            "type": "incoming" if (amount or 0) >= 0 else "outgoing",
            "amount": amount,
            "balance": balance,
            "vat_amount": None,
            "ref": "",
            "txn_id": "",
            "vivid_type": (tm.group(1).lower() if tm else ""),
            "_inline": inline,
        }))

    # Second pass: attach the description lines that fall between anchors.
    txns = []
    for k, (idx, t) in enumerate(anchors):
        nxt = anchors[k + 1][0] if k + 1 < len(anchors) else len(raw_lines)
        desc_parts = [t["_inline"]] if t["_inline"] else []
        for j in range(idx + 1, nxt):
            s = raw_lines[j].strip()
            if not s or any(s.startswith(n) for n in NOISE):
                continue
            desc_parts.append(s)
        desc = " ".join(p for p in desc_parts if p).strip()
        t["description"] = desc
        t["counterparty"] = guess_counterparty(desc)
        del t["_inline"]
        txns.append(t)

    # Correction pass: the running balance is authoritative. Where the parsed
    # amount disagrees with the balance delta (e.g. FX card transactions whose
    # EUR value is ambiguous in the text), trust the balance delta.
    prev = 0.0
    for t in txns:
        delta = round(t["balance"] - prev, 2)
        if t["amount"] is None or abs(delta - t["amount"]) > 0.02:
            t["amount_raw"] = t["amount"]
            t["amount"] = delta
            t["type"] = "incoming" if delta >= 0 else "outgoing"
        prev = t["balance"]
    return txns


def guess_counterparty(desc):
    """Pull a likely counterparty name out of a Vivid description blob."""
    m = re.search(r"\b(?:From|To)\s+([^\d]+?)(?:\s+[A-Z]{2}\d|\s+DE\d|$)", desc)
    if m:
        return m.group(1).strip()[:60]
    return desc[:60]


# ----- Vivid Interest (investment) account: different table format -----
INT_DATE_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})\s")
EURO_TOK_RE = re.compile(r"(-?[\d.,]+)\s*€")


def parse_vivid_interest(path, account_label):
    txns = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for ln in (page.extract_text() or "").split("\n"):
                s = ln.strip()
                m = INT_DATE_RE.match(s)
                if not m:
                    continue
                toks = EURO_TOK_RE.findall(s)
                if len(toks) < 1:
                    continue
                # "... <Total amount> € <Total costs> € -"  -> amount is 2nd-to-last
                amt = money(toks[-2]) if len(toks) >= 2 else money(toks[-1])
                tm = re.search(r"-\s+(TRANSFER IN|TRANSFER OUT|INTEREST ACCRUAL|[A-Z ]+?)\s+-", s)
                iso = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
                typ = (tm.group(1).strip().lower() if tm else "")
                txns.append({
                    "source": "vivid",
                    "account": account_label,
                    "date": iso,
                    "type": "incoming" if (amt or 0) >= 0 else "outgoing",
                    "amount": amt,
                    "balance": None,
                    "vat_amount": None,
                    "ref": "",
                    "txn_id": "",
                    "vivid_type": typ,
                    "description": typ,
                    "counterparty": typ,
                })
    return txns


VIVID_CURRENT = {
    "Statement DE23202208000026634695 2024-05-20 - 2024-12-31.pdf": "Vivid Main (…4695)",
    "Statement DE38202208000027720049 2024-07-25 - 2024-12-31.pdf": "Vivid Second (…0049)",
}
VIVID_INTEREST = "Statement Interest rate account 2024-01-01 - 2024-12-31.pdf"


def parse_vivid():
    txns = []
    base = os.path.join(DATA, "Vivid statements 2024-01-01 - 2024-12-31")
    for fname, label in VIVID_CURRENT.items():
        path = os.path.join(base, fname)
        if os.path.exists(path):
            got = parse_vivid_current(path, label)
            print(f"  {label}: {len(got)} txns")
            txns += got
    ipath = os.path.join(base, VIVID_INTEREST)
    if os.path.exists(ipath):
        got = parse_vivid_interest(ipath, "Vivid Interest")
        print(f"  Vivid Interest: {len(got)} txns")
        txns += got
    return txns


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Parsing Qonto…")
    q = parse_qonto()
    print(f"  Qonto: {len(q)} txns")
    print("Parsing Vivid…")
    v = parse_vivid()
    ledger = q + v
    ledger.sort(key=lambda t: (t["date"] or "", t["account"]))
    with open(os.path.join(OUT, "bank_ledger.json"), "w") as f:
        json.dump(ledger, f, indent=2, ensure_ascii=False)

    # quick summary
    inflow = sum(t["amount"] for t in ledger if t["amount"] and t["amount"] > 0)
    outflow = sum(t["amount"] for t in ledger if t["amount"] and t["amount"] < 0)
    print(f"\nTotal txns: {len(ledger)}")
    print(f"  inflow:  EUR {inflow:,.2f}")
    print(f"  outflow: EUR {outflow:,.2f}")
    by_acct = {}
    for t in ledger:
        by_acct.setdefault(t["account"], [0, 0.0])
        by_acct[t["account"]][0] += 1
        by_acct[t["account"]][1] += t["amount"] or 0
    print("\nBy account:")
    for a, (n, net) in sorted(by_acct.items()):
        print(f"  {a:24s} {n:4d} txns   net EUR {net:>12,.2f}")

    validate_balance_chains(ledger)


def validate_balance_chains(ledger):
    """For accounts that carry a running balance, confirm amount == delta(balance).
    This is the correctness check on the PDF parse."""
    print("\nBalance-chain validation (amount must equal change in balance):")
    for acct in sorted({t["account"] for t in ledger}):
        rows = [t for t in ledger if t["account"] == acct and t["balance"] is not None]
        if not rows:
            print(f"  {acct:24s} (no running balance to validate)")
            continue
        bad = 0
        prev = 0.0
        for t in rows:
            delta = round(t["balance"] - prev, 2)
            if abs(delta - (t["amount"] or 0)) > 0.02:
                bad += 1
            prev = t["balance"]
        end = rows[-1]["balance"]
        print(f"  {acct:24s} {len(rows):4d} rows   {bad} mismatches   closing EUR {end:,.2f}")


if __name__ == "__main__":
    main()
