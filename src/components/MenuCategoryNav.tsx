"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LayoutGrid, X, Check } from "lucide-react";
import { Sheet, prefersReducedMotion, scrollToId } from "@/components/Sheet";
import { cn } from "@/lib/utils";

/**
 * Category navigation for the public menu pages (catering + QR ordering).
 *
 * Replaces the horizontally-scrolling pill rail those two pages used to
 * duplicate. The rail was a poor fit for real menu data: a restaurant with
 * twenty categories, several holding one dish, and one named "KERALA SADHYA
 * AND MINI MEALS | Vegetarian Feast" — a single pill wide enough to fill a
 * phone and bury everything after it. It also never scrolled the active pill
 * into view, so the highlighted category was usually off-screen.
 *
 * Instead: a quiet bar naming the section you're in, and an index you open —
 * every category on its own roomy row, all visible at once. The rail survives
 * from `sm` up, where the horizontal room actually exists, now with the active
 * pill centred and the edges faded so it's obvious it scrolls.
 */

/**
 * Anchor id for a category's section. Exported so the page rendering the
 * sections and the nav jumping to them can't disagree — they previously each
 * had their own slug rule, and the two pages' rules had already diverged.
 */
export const menuSectionId = (category: string) =>
  `cat-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

export interface MenuNavStrings {
  menu: string;
  categories: string;
  close: string;
  items: (n: number) => string;
}

export interface MenuCategoryNavProps {
  /** English category keys, already in the restaurant's configured order. */
  categories: string[];
  labelOf: (category: string) => string;
  countOf: (category: string) => number;
  /** Row artwork in the index — a dish photo from the category, else its emoji. */
  thumbOf: (category: string) => { image_url: string | null; emoji: string };
  /** Anchor id of the category's section, so page and nav agree on where to jump. */
  sectionId: (category: string) => string;
  strings: MenuNavStrings;
}

/** Height of the bar in px — also the offset the scroll-spy allows for. */
const BAR_H = 56;

export function MenuCategoryNav({
  categories, labelOf, countOf, thumbOf, sectionId, strings,
}: MenuCategoryNavProps) {
  const [active, setActive] = useState<string | null>(categories[0] ?? null);
  const [indexOpen, setIndexOpen] = useState(false);
  const railRef = useRef<HTMLUListElement>(null);
  const pillRefs = useRef(new Map<string, HTMLButtonElement>());

  // Which section is nearest the top of the viewport. The bottom margin keeps
  // a section from claiming "active" while it's only peeking in at the foot of
  // the screen, which made the label flicker between two categories.
  useEffect(() => {
    if (!categories.length) return;
    const byId = new Map(categories.map((c) => [sectionId(c), c]));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const found = visible[0] && byId.get(visible[0].target.id);
        if (found) setActive(found);
      },
      { rootMargin: `-${BAR_H + 64}px 0px -70% 0px` },
    );
    for (const c of categories) {
      const el = document.getElementById(sectionId(c));
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [categories, sectionId]);

  // Keep the active pill in view on the rail — without this the highlight
  // regularly sat off-screen, which is what made the old bar feel broken.
  //
  // Scrolling the rail by hand rather than with pill.scrollIntoView(), which
  // scrolls every scrollable ancestor including the document — it is entitled
  // to move the page under the reader to reveal a pill, which is never what
  // this wants.
  useEffect(() => {
    if (!active || indexOpen) return;
    const rail = railRef.current;
    const pill = pillRefs.current.get(active);
    if (!rail || !pill || pill.offsetParent === null) return;
    const left = pill.offsetLeft - (rail.clientWidth - pill.clientWidth) / 2;
    rail.scrollTo({
      left: Math.max(0, left),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [active, indexOpen]);

  const jump = useCallback(
    (category: string) => {
      setIndexOpen(false);
      setActive(category);
      scrollToId(sectionId(category));
    },
    [sectionId],
  );

  if (!categories.length) return null;
  const activeLabel = active ? labelOf(active) : strings.categories;

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 sm:px-6" style={{ height: BAR_H }}>
          {/* Phones get the section name; the rail needs room they don't have. */}
          <p className="min-w-0 flex-1 sm:hidden" aria-live="polite">
            <span className="block truncate text-sm font-semibold text-white">{activeLabel}</span>
            {active && (
              <span className="block text-[11px] text-zinc-500">{strings.items(countOf(active))}</span>
            )}
          </p>

          <ul
            ref={railRef}
            aria-label={strings.categories}
            className="hidden min-w-0 flex-1 gap-1.5 overflow-x-auto sm:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              maskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 28px), transparent)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black 16px, black calc(100% - 28px), transparent)",
            }}
          >
            {categories.map((c) => {
              const current = active === c;
              return (
                <li key={c}>
                  <button
                    ref={(el) => {
                      if (el) pillRefs.current.set(c, el);
                      else pillRefs.current.delete(c);
                    }}
                    onClick={() => jump(c)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "min-h-[38px] shrink-0 cursor-pointer rounded-full px-3.5 text-xs font-semibold whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                      current
                        ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                        : "border border-line bg-white/[0.03] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
                    )}
                  >
                    {labelOf(c)}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            onClick={() => setIndexOpen(true)}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-3.5 text-xs font-semibold text-zinc-200 transition-all hover:border-zinc-500 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none active:scale-[0.97]"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
            {strings.menu}
          </button>
        </div>
      </div>

      {indexOpen && (
        <Sheet
          size="lg"
          label={strings.categories}
          titleId="menu-index-title"
          onClose={() => setIndexOpen(false)}
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <h2 id="menu-index-title" className="font-display text-base font-bold text-white">
              {strings.categories}
            </h2>
            <button
              onClick={() => setIndexOpen(false)}
              aria-label={strings.close}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <ul className="p-2">
            {categories.map((c, i) => {
              const current = active === c;
              const thumb = thumbOf(c);
              return (
                <li key={c} data-index-row style={{ ["--i" as string]: i }}>
                  <button
                    onClick={() => jump(c)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                      current ? "bg-brand-400/10" : "hover:bg-white/[0.04]",
                    )}
                  >
                    {thumb.image_url ? (
                      <img
                        src={thumb.image_url}
                        alt=""
                        loading="lazy"
                        className="h-11 w-11 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-white/[0.06] to-white/[0.02] text-xl"
                      >
                        {thumb.emoji}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-sm font-semibold text-balance",
                          current ? "text-brand-300" : "text-white",
                        )}
                      >
                        {labelOf(c)}
                      </span>
                      <span className="block text-[11px] text-zinc-500">{strings.items(countOf(c))}</span>
                    </span>
                    {current && <Check className="h-4 w-4 shrink-0 text-brand-300" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Sheet>
      )}
    </>
  );
}
