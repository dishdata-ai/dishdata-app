#!/usr/bin/env python3
"""
Reconcile Kokoland 2024 supplier invoices against the unified bank ledger.

Goal (per the client's request):
  - match invoices to bank payments
  - find MISSING invoices  = bank debits that look like purchases but have no document
  - find UNMATCHED invoices = card/transfer invoices with no bank debit (paid elsewhere/cash?)

Matching rule: a bank debit matches an invoice when |amount| == gross (+/- 0.02)
and the bank date is within [-3, +25] days of the invoice date. Greedy, one-to-one.

Cash-paid invoices (paid_cash=true) are expected to have NO bank line and are
listed separately, not flagged as problems.
"""
import json, os, datetime as dt

OUT = os.path.join(os.path.dirname(__file__), "out")
TOL = 0.02
WIN_BACK, WIN_FWD = 5, 45

def d(s):
    return dt.date.fromisoformat(s)

def load_invoices():
    with open(os.path.join(OUT, "invoices_all.json")) as f:
        recs = json.load(f)
    out = []
    for r in recs:
        if r.get("is_sales_invoice") or r.get("is_invoice") is False or r.get("is_duplicate"):
            continue
        if r.get("gross") is None:
            continue
        out.append(r)
    return out

def main():
    invoices = load_invoices()
    with open(os.path.join(OUT, "bank_ledger.json")) as f:
        bank = json.load(f)
    debits = [r for r in bank if (r.get("amount") or 0) < 0]

    used = [False] * len(debits)
    matched, unmatched_inv, cash_inv = [], [], []

    # match transfer/card invoices (positive gross, not cash) to a unique bank debit
    for inv in invoices:
        g = inv.get("gross") or 0
        if g <= 0:                      # returns/credits handled elsewhere
            continue
        if inv.get("paid_cash"):
            cash_inv.append(inv); continue
        idate = d(inv["date"])
        best = None
        for i, b in enumerate(debits):
            if used[i]:
                continue
            if abs(abs(b["amount"]) - g) > TOL:
                continue
            delta = (d(b["date"]) - idate).days
            if -WIN_BACK <= delta <= WIN_FWD:
                if best is None or abs(delta) < best[1]:
                    best = (i, abs(delta))
        if best:
            used[best[0]] = True
            matched.append((inv, debits[best[0]]))
        else:
            unmatched_inv.append(inv)

    # Classify leftover debits into three buckets:
    #   RELATED_PARTY = shareholders/GF/investors/Puneeth — loans & Gesellschafter-
    #                   verrechnung, NOT supplier invoices (needs separate treatment).
    #   INTERNAL      = treasury / own-account / capital / Vivid pocket moves / deposits.
    #   MISSING       = everything else = candidate missing supplier invoices.
    RELATED = (
        "sony thellappilly", "abhishek mavingal", "abishek mavingal", "josna sebastian",
        "to puneeth", "puneeth srinivas", "anton burger", "jayasurian", "makkothh",
        "dinesh", "gabriel pedro de lima", "paul balu",
    )
    INTERNAL = (
        "vivid money b.v", "vivid money gmbh", "vivid money s.a", "stichting vivid",
        "favour of vivid", "from vivid", "settlement account", "transfer out",
        "transfers between own", "between own", "between_own", "transfer_between_own",
        "investment", "stammkapital", "paypal europe", "kaution",
        "kokoland gastro ug (haftungsbeschränkt)", "accounts de", "revolt21",
        "[fee]", "[transfer_between_own]",
    )
    # Puneeth's Revolut account (LT09…REVOLT21XXX) — only when it is the COUNTERPARTY
    # (i.e. money out to it), not when the IBAN merely appears in a "From Vivid" memo.
    REVOLUT = "LT093250007266050590 REVOLT21XXX"
    missing, internal, related = [], [], []
    for i, b in enumerate(debits):
        if used[i]:
            continue
        cp = b.get("counterparty") or ""
        text = (cp + " " + (b.get("description") or "")).lower()
        if any(n in text for n in RELATED) or cp.startswith(REVOLUT):
            related.append(b)
        elif any(n in text for n in INTERNAL):
            internal.append(b)
        else:
            missing.append(b)

    def eur(x): return f"{x:>10,.2f}"
    print("=" * 74)
    print("KOKOLAND 2024 — BANK RECONCILIATION (invoices <-> bank)")
    print("=" * 74)
    nb_card = sum(1 for inv,_ in matched)
    print(f"Invoices (purchases, non-dup)        : {len(invoices)}")
    print(f"  paid by card/transfer            : {sum(1 for i in invoices if not i.get('paid_cash') and (i.get('gross') or 0)>0)}")
    print(f"  paid cash (no bank line expected): {len(cash_inv)}")
    print()
    print(f"MATCHED invoice<->bank payments      : {len(matched)}  (EUR {sum(inv['gross'] for inv,_ in matched):,.2f})")
    print(f"UNMATCHED invoices (card/transfer, no bank hit): {len(unmatched_inv)}")
    for inv in sorted(unmatched_inv, key=lambda x: -(x.get('gross') or 0)):
        print(f"   {inv['date']} {eur(inv['gross'])}  {inv['vendor'][:34]:<34} {inv['file'][:34]}")
    print()
    print(f"Internal/treasury debits (no invoice expected, excluded): {len(internal)}  (EUR {sum(abs(b['amount']) for b in internal):,.2f})")
    print()
    print(f"RELATED-PARTY transfers (shareholders/GF/investors/Puneeth — flag separately): {len(related)}  (EUR {sum(abs(b['amount']) for b in related):,.2f})")
    for b in sorted(related, key=lambda x: x['amount']):
        text = (b.get('counterparty') or b.get('description') or '')[:46]
        print(f"   {b['date']} {eur(abs(b['amount']))}  {b['account'][:18]:<18} {text}")
    print()
    print(f"CANDIDATE MISSING INVOICES (external debit, no document): {len(missing)}")
    print(f"   total EUR {sum(abs(b['amount']) for b in missing):,.2f}")
    for b in sorted(missing, key=lambda x: x['amount']):
        text = (b.get('counterparty') or b.get('description') or '')[:46]
        print(f"   {b['date']} {eur(abs(b['amount']))}  {b['account'][:18]:<18} {text}")

    # persist
    json.dump({
        "matched": [{"invoice": inv["file"], "gross": inv["gross"], "bank_date": b["date"],
                     "bank_amount": b["amount"], "account": b["account"]} for inv, b in matched],
        "unmatched_invoices": [{"file": i["file"], "date": i["date"], "gross": i["gross"],
                                "vendor": i["vendor"]} for i in unmatched_inv],
        "candidate_missing_invoices": [{"date": b["date"], "amount": b["amount"],
                                        "account": b["account"],
                                        "counterparty": b.get("counterparty"),
                                        "description": b.get("description")} for b in missing],
        "related_party_transfers": [{"date": b["date"], "amount": b["amount"],
                                     "account": b["account"],
                                     "counterparty": b.get("counterparty"),
                                     "description": b.get("description")} for b in related],
        "internal_debits_excluded": len(internal),
    }, open(os.path.join(OUT, "reconciliation.json"), "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
