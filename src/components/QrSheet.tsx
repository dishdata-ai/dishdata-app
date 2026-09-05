import { createPortal } from "react-dom";
import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { QrCode } from "@/components/QrCode";

/**
 * A single QR value, tiled 10-up on one A4 sheet, sized to be cut into
 * table-tent-sized cards rather than printed one at a time.
 *
 * Regenerates the QR from its source value instead of embedding an image, so
 * every copy on the sheet is rendered at print resolution — a screenshot
 * enlarged 10x would soften into unscannable noise at the edges.
 *
 * 2 columns x 5 rows on A4 gives each card 105mm x 59.4mm — big enough for a
 * thumb to scan comfortably from across a table, small enough that a
 * standard paper cutter does all ten in two straight cuts.
 */
const COLS = 2;
const ROWS = 5;
const COUNT = COLS * ROWS;

function Sheet({ value, title, subtitle }: { value: string; title: string; subtitle?: string }) {
  return (
    <div
      className="grid bg-white"
      style={{
        width: "210mm",
        height: "297mm",
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      }}
    >
      {Array.from({ length: COUNT }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col items-center justify-center gap-[2mm] overflow-hidden border border-dashed border-zinc-300 p-[3mm] text-center"
        >
          {/* 59.4mm-tall cell, 3mm padding each side, 2mm gap: the QR must
              stay under ~40mm or it — plus the label — no longer fits, and a
              row that overflows its grid track doesn't get clipped, it pushes
              onto a second printed page instead. 150px ≈ 39.7mm, leaving a
              safety margin rather than sitting exactly at the limit. */}
          <QrCode value={value} size={150} />
          <div>
            <p className="font-display text-[11pt] leading-tight font-bold text-zinc-900">{title}</p>
            {subtitle && <p className="text-[8pt] leading-tight text-zinc-500">{subtitle}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function QrSheetModal({
  open, onClose, value, title, subtitle,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  title: string;
  subtitle?: string;
}) {
  // Scoped to this dialog only. The app's other in-place printers (menu sheet,
  // Z-report, floor plan) each own their print rules the same way, so no two
  // features can blank each other's output out.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("printing-qr-sheet");
    return () => document.body.classList.remove("printing-qr-sheet");
  }, [open]);

  const PREVIEW_SCALE = 0.42;

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Print ${COUNT} for cutting`}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            One A4 sheet, {COLS}&times;{ROWS} — cut along the dashed lines for {COUNT} cards sized
            for a table or counter.
          </p>
          <div className="overflow-hidden rounded-xl border border-line">
            <div style={{ height: `calc(297mm * ${PREVIEW_SCALE})` }}>
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}>
                <Sheet value={value} title={title} subtitle={subtitle} />
              </div>
            </div>
          </div>
          <Button className="w-full" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
        </div>
      </Modal>

      {open &&
        createPortal(
          <div className="qr-sheet-print-root">
            <style>{"@page { size: A4 portrait; margin: 0; }"}</style>
            <Sheet value={value} title={title} subtitle={subtitle} />
          </div>,
          document.body,
        )}
    </>
  );
}
