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

/**
 * One QR *per table* instead of one QR repeated — still a single A4 sheet,
 * so the grid has to flex with however many tables the restaurant has
 * (Kokoland has 9, Big Brewsky 11 — already past the fixed 2x5 the takeaway
 * sheet gets away with, since that one only ever tiles a single value).
 * Chooses a column count from the table count so cells stay close to A4's
 * own portrait aspect ratio, then sizes the QR to fit what's left of the
 * cell after padding/label — capped at 150px, the same size the takeaway
 * sheet uses, so a typical table count (comfortably under ~15) prints at
 * identical size to "same size as takeaway" without asking for it specially.
 */
function tableGrid(count: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (210 / 297))));
  const rows = Math.max(1, Math.ceil(count / cols));
  return { cols, rows };
}

function MultiSheet({ cells }: { cells: { value: string; title: string; subtitle?: string }[] }) {
  const { cols, rows } = tableGrid(cells.length);
  const cellWidthMm = 210 / cols;
  const cellHeightMm = 297 / rows;
  // 16mm ≈ padding (3mm x2) + gap (2mm) + label (≈9mm) — what's left over is
  // the QR's own budget; 3.78 ≈ px-per-mm at the 96dpi these components
  // already render at (see QrSheet's own "150px ≈ 39.7mm" note).
  const qrSize = Math.max(60, Math.min(150, Math.round((Math.min(cellWidthMm, cellHeightMm) - 16) * 3.78)));

  return (
    <div
      className="grid bg-white"
      style={{
        width: "210mm",
        height: "297mm",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells.map((c, i) => (
        <div
          key={i}
          className="flex flex-col items-center justify-center gap-[2mm] overflow-hidden border border-dashed border-zinc-300 p-[3mm] text-center"
        >
          <QrCode value={c.value} size={qrSize} />
          <div>
            <p className="font-display text-[11pt] leading-tight font-bold text-zinc-900">{c.title}</p>
            {c.subtitle && <p className="text-[8pt] leading-tight text-zinc-500">{c.subtitle}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableQrSheetModal({
  open, onClose, tables,
}: {
  open: boolean;
  onClose: () => void;
  tables: { id: string; name: string; url: string }[];
}) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("printing-qr-sheet");
    return () => document.body.classList.remove("printing-qr-sheet");
  }, [open]);

  const PREVIEW_SCALE = 0.42;
  const cells = tables.map((t) => ({ value: t.url, title: `Table ${t.name}`, subtitle: "Scan to order" }));

  return (
    <>
      <Modal open={open} onClose={onClose} title="Print table QR codes">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            One A4 sheet, one QR per table ({tables.length} total) — cut along the dashed lines and place
            one on each table.
          </p>
          <div className="overflow-hidden rounded-xl border border-line">
            <div style={{ height: `calc(297mm * ${PREVIEW_SCALE})` }}>
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}>
                <MultiSheet cells={cells} />
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
            <MultiSheet cells={cells} />
          </div>,
          document.body,
        )}
    </>
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
