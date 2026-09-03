"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import {
  buildSections, paginate, sheetDate,
  type SheetPage, type SheetSection,
} from "@/lib/menu-sheet";
import { cn } from "@/lib/utils";
import type { Org, Recipe } from "@/lib/api/database.types";

/**
 * A print-ready "Today's Menu" sheet, generated from whatever is actually
 * available in the POS right now.
 *
 * This deliberately produces A4 pages rather than a PDF file: the browser's own
 * "Save as PDF" makes a better, smaller, text-selectable PDF than any bundled
 * renderer would, and it costs no dependency and no serverless cold-start. The
 * tradeoff is one extra tap in the print dialog.
 */

const SHEET_CLASS = "menu-print-root";

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(value);
  } catch {
    // An org with a nonstandard currency code shouldn't blank the whole menu.
    return `${value.toFixed(2)} ${currency}`;
  }
}

function Section({ section, currency, ink }: { section: SheetSection; currency: string; ink: string }) {
  return (
    <div className="mb-[7mm]">
      <h3 className="text-[13pt] leading-none font-bold tracking-tight" style={{ color: ink }}>
        {section.category}
        {section.continued && (
          <span className="ml-1.5 text-[8.5pt] font-normal opacity-60">(Fortsetzung)</span>
        )}
      </h3>
      <div className="mt-[2mm] mb-[3mm] h-px w-full" style={{ background: ink, opacity: 0.35 }} />
      <ul>
        {section.items.map((item, i) => (
          <li key={i} className={cn(item.description ? "mb-[2.4mm]" : "mb-[1.7mm]")}>
            <div className="flex items-baseline gap-2 text-[10.5pt] leading-tight">
              <span className="text-zinc-800">{item.name}</span>
              {item.price !== null && (
                <>
                  <span className="min-w-[4mm] flex-1" />
                  <span className="font-bold whitespace-nowrap" style={{ color: ink }}>
                    {money(item.price, currency)}
                  </span>
                </>
              )}
            </div>
            {item.description && (
              <p className="mt-[0.8mm] pr-[14mm] text-[8pt] leading-snug text-zinc-500">
                {item.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Page({
  page, org, ink, index, total, tagline, footnote,
}: {
  page: SheetPage;
  org: Org;
  ink: string;
  index: number;
  total: number;
  tagline: string;
  footnote: string;
}) {
  const first = index === 0;
  const last = index === total - 1;
  const [left, right] = page;

  return (
    <div
      className="menu-page flex flex-col overflow-hidden bg-[#F1F3F0] px-[14mm] pt-[12mm] pb-[10mm] text-zinc-900"
      style={{ width: "210mm", height: "297mm" }}
    >
      {first ? (
        <div className="flex shrink-0 items-start justify-between">
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt="" className="h-[30mm] w-auto object-contain" />
          ) : (
            <span className="text-[20pt] font-bold" style={{ color: ink }}>
              {org.name}
            </span>
          )}
          <div className="pt-[2mm] text-right">
            <p className="text-[8.5pt] text-zinc-500">{sheetDate()}</p>
            <h1 className="mt-[6mm] text-[30pt] leading-none font-light" style={{ color: ink }}>
              Today&rsquo;s Menu
            </h1>
            <div className="mt-[3mm] flex items-center gap-[2mm]">
              <span className="h-[2mm] w-[2mm] rounded-full" style={{ background: ink }} />
              <span className="h-px flex-1" style={{ background: ink, opacity: 0.5 }} />
            </div>
          </div>
        </div>
      ) : (
        // Later pages get a slim running header: the reader already knows what
        // this is, and the space is better spent on dishes.
        <div className="flex shrink-0 items-baseline justify-between border-b pb-[2mm]" style={{ borderColor: `${ink}59` }}>
          <span className="text-[10pt] font-bold" style={{ color: ink }}>
            {org.name} · Today&rsquo;s Menu
          </span>
          <span className="text-[8.5pt] text-zinc-500">{sheetDate()}</span>
        </div>
      )}

      <div className={cn("min-h-0 flex-1", first ? "mt-[10mm]" : "mt-[6mm]")}>
        <div className="grid grid-cols-2 content-start gap-x-[12mm]">
          <div>
            {left.map((s, i) => (
              <Section key={`${s.category}-${i}`} section={s} currency={org.currency} ink={ink} />
            ))}
          </div>
          <div>
            {right.map((s, i) => (
              <Section key={`${s.category}-${i}`} section={s} currency={org.currency} ink={ink} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-[6mm] shrink-0">
        {last ? (
          <>
            {tagline && (
              <p
                className="mb-[5mm] text-center text-[9pt] font-bold tracking-[0.25em] uppercase"
                style={{ color: ink }}
              >
                {tagline}
              </p>
            )}
            <p className="text-[8.5pt] font-bold" style={{ color: ink }}>
              Available today while stocks last
            </p>
            <p className="mt-[1mm] text-[8pt] text-zinc-500">{footnote}</p>
          </>
        ) : (
          <p className="text-right text-[8pt] text-zinc-400">
            {index + 1} / {total}
          </p>
        )}
      </div>
    </div>
  );
}

export function MenuSheet({
  org, recipes, withDescriptions,
}: {
  org: Org;
  recipes: Recipe[];
  withDescriptions: boolean;
}) {
  const ink = org.accent_color || "#14523C";
  const settings = (org.settings ?? {}) as { menuSheet?: { tagline?: string; footnote?: string } };
  const tagline = settings.menuSheet?.tagline ?? "";
  const footnote =
    settings.menuSheet?.footnote ??
    "Please ask our team about allergens and dietary requirements.";

  const pages = useMemo(
    () => paginate(buildSections(recipes, withDescriptions)),
    [recipes, withDescriptions],
  );
  const empty = pages.length === 1 && !pages[0][0].length && !pages[0][1].length;

  if (empty) {
    return (
      <div
        className="flex items-center justify-center bg-[#F1F3F0] p-[20mm] text-center"
        style={{ width: "210mm", height: "297mm" }}
      >
        <p className="text-[11pt] text-zinc-500">
          Nothing is marked available right now — un-hide a few dishes in Recipes first.
        </p>
      </div>
    );
  }

  return (
    <>
      {pages.map((page, i) => (
        <Page
          key={i}
          page={page}
          org={org}
          ink={ink}
          index={i}
          total={pages.length}
          tagline={tagline}
          footnote={footnote}
        />
      ))}
    </>
  );
}

/**
 * Preview + print. The sheet is rendered twice: once scaled down inside the
 * modal so the manager can eyeball it, and once at true A4 in a portal that is
 * hidden on screen and is the *only* thing visible to the printer (see the
 * print rules in globals.css). Printing a transform-scaled node rasterizes
 * badly in some browsers, which is why the print copy is never scaled.
 */
const PREVIEW_SCALE = 0.42;

export function MenuSheetModal({
  open, onClose, org, recipes,
}: {
  open: boolean;
  onClose: () => void;
  org: Org;
  recipes: Recipe[];
}) {
  const [withDescriptions, setWithDescriptions] = useState(false);

  // Both the body class and the borderless @page live only while this dialog
  // is open, so the app's other in-place printers (Z-report, floor plan) keep
  // their own margins and are never blanked by the sheet's print rules.
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("printing-menu");
    return () => document.body.classList.remove("printing-menu");
  }, [open]);

  const { count, pageCount } = useMemo(() => {
    const sections = buildSections(recipes, withDescriptions);
    return {
      count: sections.reduce((n, s) => n + s.items.length, 0),
      pageCount: paginate(sections).length,
    };
  }, [recipes, withDescriptions]);

  return (
    <>
      <Modal open={open} onClose={onClose} title="Today's Menu" wide>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            {count} item{count === 1 ? "" : "s"} available right now, over {pageCount} page
            {pageCount === 1 ? "" : "s"} — built from what is visible and not sold out in Recipes.
            Hide a dish or mark it sold out and it disappears from here too.
          </p>

          <div className="flex gap-2">
            {([false, true] as const).map((v) => (
              <button
                key={String(v)}
                onClick={() => setWithDescriptions(v)}
                className={cn(
                  "flex-1 cursor-pointer rounded-xl border p-3 text-left transition-all",
                  withDescriptions === v
                    ? "border-brand-400/60 bg-brand-400/10"
                    : "border-line bg-white/[0.02] hover:border-zinc-500",
                )}
              >
                <span className="block text-sm font-semibold text-white">
                  {v ? "With descriptions" : "Prices only"}
                </span>
                <span className="block text-xs text-zinc-500">
                  {v ? "Fuller, usually two pages" : "Compact — the classic table sheet"}
                </span>
              </button>
            ))}
          </div>

          {/* True-size pages scaled to fit the modal. The wrapper's height is
              the scaled height so the preview leaves no dead space below. */}
          <div className="max-h-[46vh] overflow-y-auto rounded-xl border border-line">
            <div style={{ height: `calc(297mm * ${PREVIEW_SCALE} * ${pageCount})` }}>
              <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }}>
                <MenuSheet org={org} recipes={recipes} withDescriptions={withDescriptions} />
              </div>
            </div>
          </div>

          <Button className="w-full" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
          <p className="text-center text-[11px] text-zinc-500">
            In the print dialog choose &ldquo;Save as PDF&rdquo; to get a file you can send or upload.
          </p>
        </div>
      </Modal>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className={SHEET_CLASS}>
            <style>{"@page { size: A4 portrait; margin: 0; }"}</style>
            <MenuSheet org={org} recipes={recipes} withDescriptions={withDescriptions} />
          </div>,
          document.body,
        )}
    </>
  );
}
