"""
Enumerate every PDF in the 2024 folder, classify it, and pre-extract text for
the digital ones. Produces out/manifest.json — the worklist for invoice
extraction.

kind:
  supplier  - a supplier bill/invoice to reconcile (the ones we care about)
  advisor   - the tax advisor's own deliverables/invoices (Jahresabschluss,
              USt/KSt/ESt-Erklärung, their Rechnungen to Kokoland)
  lease     - the kitchen lease contract
  other     - top-level commission etc.
"""
import json
import os
import re
from glob import glob

import pdfplumber

DATA = "/Users/sonythellappillyskariah/Downloads/Invoices & Bills - 2024"
OUT = os.path.join(os.path.dirname(__file__), "out")

# Filename fragments that mark tax-advisor deliverables, not supplier bills.
ADVISOR_HINTS = ("Jahresabschluss", "ESt-Erklärung", "KSt-Erklärung", "USt-Erklärung",
                 "Auftrag Einreichung", "anMdt", "Steuererklärung",
                 "Rechnung 145_2026", "Rechnung 1894_2025")


def classify(path):
    rel = os.path.relpath(path, DATA)
    name = os.path.basename(path)
    if "Vivid statements" in rel or "QONTO" in rel:
        return "bank"
    if any(h in name for h in ADVISOR_HINTS):
        return "advisor"
    if "Lease kitchen" in rel:
        return "lease"
    if rel.startswith("W") and " - " in rel:   # weekly folder => supplier bill
        return "supplier"
    return "other"


def week_of(path):
    rel = os.path.relpath(path, DATA)
    m = re.match(r"(W\d+) -", rel)
    return m.group(1) if m else ""


def main():
    os.makedirs(OUT, exist_ok=True)
    pdfs = sorted(glob(os.path.join(DATA, "**", "*.pdf"), recursive=True))
    manifest = []
    for p in pdfs:
        kind = classify(p)
        if kind == "bank":
            continue
        try:
            with pdfplumber.open(p) as pdf:
                npages = len(pdf.pages)
                text = "\n".join((pg.extract_text() or "") for pg in pdf.pages)
        except Exception as e:
            npages, text = 0, ""
        scanned = len(text.strip()) < 40
        manifest.append({
            "file": os.path.basename(p),
            "rel": os.path.relpath(p, DATA),
            "abspath": p,
            "kind": kind,
            "week": week_of(p),
            "pages": npages,
            "scanned": scanned,
            "text": text if not scanned else "",   # keep text only for digital
        })

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    # summary
    from collections import Counter
    by_kind = Counter(m["kind"] for m in manifest)
    scanned_supplier = [m for m in manifest if m["kind"] == "supplier" and m["scanned"]]
    text_supplier = [m for m in manifest if m["kind"] == "supplier" and not m["scanned"]]
    print(f"manifest: {len(manifest)} docs (excl. bank statements)")
    for k, n in by_kind.most_common():
        print(f"  {k:10s} {n}")
    print(f"\nsupplier bills: {len([m for m in manifest if m['kind']=='supplier'])}"
          f"  ({len(text_supplier)} text, {len(scanned_supplier)} scanned)")
    print("\nScanned supplier bills to read (by week):")
    from itertools import groupby
    sb = sorted(scanned_supplier, key=lambda m: (m["week"], m["file"]))
    for wk, grp in groupby(sb, key=lambda m: m["week"]):
        files = list(grp)
        print(f"  {wk or '(top)':8s} {len(files):2d}: " + ", ".join(f["file"][:22] for f in files[:4])
              + (" …" if len(files) > 4 else ""))


if __name__ == "__main__":
    main()
