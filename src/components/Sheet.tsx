"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Dialog furniture shared by the public menu pages (catering + QR ordering).
 *
 * Deliberately separate from `ui.tsx`'s `Modal`: that one is the admin app's
 * centred dialog and every internal view depends on its exact look, while
 * these are guest-facing and want to be a bottom sheet on a phone — the
 * reachable half of the screen — and a centred card only once there's room.
 */

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Smooth scroll unless the visitor asked their OS for less motion. */
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * Keeps Tab inside an open dialog and hands focus back to whatever opened it.
 * Without this a keyboard or screen-reader visitor tabs straight out of the
 * dialog into the menu behind it, which is still rendered and still focusable.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(selector) ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose, ref]);
}

/**
 * Bottom sheet on phones, centred dialog from `sm` up. Rendered only while
 * open (the caller conditionally mounts it), so opening always replays the
 * entrance animation.
 */
export function Sheet({
  children,
  onClose,
  label,
  titleId,
  size = "md",
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
  titleId: string;
  /** `md` for forms and summaries; `lg` for the category index, which is a list. */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="animate-fade absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={titleId}
        className={cn(
          "animate-sheet-up relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl sm:animate-rise sm:rounded-2xl",
          size === "lg" ? "sm:max-w-lg" : "sm:max-w-md",
        )}
      >
        {children}
      </div>
    </div>
  );
}
