"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";

const KEY = "dishdata:install-hint-dismissed";

/**
 * iPhones never offer an install prompt — the only way to get DishData on the home screen is
 * Safari's Share menu. This tells people so, once, and only when it's useful: on iOS, in the
 * browser (not already installed), and not dismissed before.
 */
export default function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent;
      const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const installed =
        (navigator as Navigator & { standalone?: boolean }).standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      if (iOS && !installed && localStorage.getItem(KEY) !== "1") setShow(true);
    } catch {
      // Storage or matchMedia unavailable (private mode, old browser): better to say nothing than to nag every visit.
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* it will simply show again next visit */
    }
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand-400/30 bg-brand-400/[0.06] p-3 text-sm text-zinc-300">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">Put DishData on your home screen</p>
        <p className="mt-0.5 text-xs text-zinc-400">
          Tap <Share className="mx-0.5 inline h-3.5 w-3.5 -translate-y-px text-accent-400" aria-label="Share" /> in Safari,
          then <strong className="text-zinc-200">Add to Home Screen</strong>. It opens full-screen like an app.
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 cursor-pointer rounded p-1 text-zinc-500 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
