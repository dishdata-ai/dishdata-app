"""
Heuristic parser for the 16 DIGITAL (text) supplier bills. Extracts gross / net /
VAT and recipient-name flags from the already-extracted PDF text in manifest.json.

Writes out/invoices_text.json. Anything it can't confidently read is left with
null amounts and flagged needs_review=True for manual confirmation.
"""
import json
import os
import re

OUT = os.path.join(os.path.dirname(__file__), "out")


def num(s):
    """German/european number '1.169,00' or '982,35' or '366.45' -> float."""
    if s is None:
        return None
    s = s.strip().replace(" ", "")
    # If it has both '.' and ',', '.' is thousands and ',' decimal (German).
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


AMT = r"([\d.]+,\d{2}|\d+\.\d{2})"

PATTERNS = {
    "gross": [rf"Gesamt\s*Brutto\s*{AMT}", rf"Rechnungsbetrag\s*(?:brutto)?\s*{AMT}",
              rf"Gesamtbetrag\s*(?:brutto)?\s*{AMT}\s*EUR", rf"Bruttobetrag\s*{AMT}",
              rf"Zu\s*zahlen\s*{AMT}", rf"Summe\s*brutto\s*{AMT}"],
    "net":   [rf"Gesamt\s*Netto\s*{AMT}", rf"Nettobetrag\s*{AMT}",
              rf"Summe\s*netto\s*{AMT}", rf"Zwischensumme\s*netto\s*{AMT}"],
    "vat":   [rf"Gesamt\s*MwSt\.?\s*{AMT}", rf"MwSt\.?\s*(?:19|7)\s*%?\s*{AMT}",
              rf"USt\.?\s*(?:19|7)\s*%?\s*{AMT}", rf"zzgl\.?\s*(?:19|7)\s*%\s*MwSt\.?\s*{AMT}",
              rf"Umsatzsteuer\s*{AMT}"],
}


def find(text, keys):
    for pat in keys:
        m = re.search(pat, text, re.I)
        if m:
            return num(m.group(1))
    return None


def vat_rate(text):
    if re.search(r"\b19\s*%", text):
        return 19
    if re.search(r"\b7\s*%", text):
        return 7
    return None


def main():
    M = json.load(open(os.path.join(OUT, "manifest.json")))
    out = []
    for m in M:
        if m["kind"] != "supplier" or m["scanned"]:
            continue
        t = m["text"]
        gross = find(t, PATTERNS["gross"])
        net = find(t, PATTERNS["net"])
        vat = find(t, PATTERNS["vat"])
        # Derive the third value if two are known.
        if gross and net and vat is None:
            vat = round(gross - net, 2)
        if gross and vat and net is None:
            net = round(gross - vat, 2)
        if net and vat and gross is None:
            gross = round(net + vat, 2)

        has_puneeth = bool(re.search(r"Puneeth|Srinivas", t, re.I))
        has_kokoland = bool(re.search(r"Kokoland", t, re.I))
        rate = vat_rate(t)
        # invoice no + date guesses
        inv = None
        mi = re.search(r"Rechnungs?-?Nr\.?:?\s*([A-Z0-9/_-]{4,})", t, re.I)
        if mi:
            inv = mi.group(1)
        dt = None
        md = re.search(r"(\d{2})\.(\d{2})\.(20\d{2})", t)
        if md:
            dt = f"{md.group(3)}-{md.group(2)}-{md.group(1)}"

        out.append({
            "file": m["file"],
            "rel": m["rel"],
            "week": m["week"],
            "kind": "supplier",
            "source": "text",
            "invoice_no": inv,
            "date": dt,
            "net": net,
            "vat_amount": vat,
            "vat_rate": rate,
            "gross": gross,
            "addressed_to_company": has_kokoland and not has_puneeth,
            "has_kokoland": has_kokoland,
            "has_puneeth": has_puneeth,
            "needs_review": gross is None,
        })

    with open(os.path.join(OUT, "invoices_text.json"), "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"parsed {len(out)} text supplier bills")
    ok = [r for r in out if not r["needs_review"]]
    print(f"  confident (gross found): {len(ok)}   needs_review: {len(out)-len(ok)}")
    tot_vat = sum(r["vat_amount"] or 0 for r in out)
    print(f"  total VAT (text bills): EUR {tot_vat:,.2f}")
    print("\n  file                                       gross    net      vat   rate  P  K")
    for r in out:
        print(f"  {r['file'][:40]:40s} {str(r['gross']):>8} {str(r['net']):>8} "
              f"{str(r['vat_amount']):>7} {str(r['vat_rate']):>4}  "
              f"{'P' if r['has_puneeth'] else '.'}  {'K' if r['has_kokoland'] else '.'}"
              + ("  <review" if r['needs_review'] else ""))


if __name__ == "__main__":
    main()
