"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { TOUR_STEPS, TOUR_DONE_KEY } from "@/lib/tour";
import { Button } from "@/components/ui";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export default function TourOverlay() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  // Start when ?tour=1 (set by onboarding) and not completed before
  useEffect(() => {
    if (searchParams?.get("tour") === "1") {
      setStep(0);
      const next = new URLSearchParams(searchParams.toString());
      next.delete("tour");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }
  }, [searchParams, router, pathname]);

  // Allow re-triggering from anywhere (account menu "Replay tour")
  useEffect(() => {
    const handler = () => setStep(0);
    window.addEventListener("dishdata:start-tour", handler);
    return () => window.removeEventListener("dishdata:start-tour", handler);
  }, []);

  const measure = useCallback(() => {
    if (step === null) return;
    const target = TOUR_STEPS[step]?.target;
    if (!target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  if (step === null) return null;
  const s = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(TOUR_DONE_KEY, "1");
    setStep(null);
  };

  // Tooltip position: below the spotlight if room, else above; centered when no target
  const tooltipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.top + rect.height + 14 + 320 < window.innerHeight ? rect.top + rect.height + 14 : undefined,
        bottom:
          rect.top + rect.height + 14 + 320 >= window.innerHeight
            ? window.innerHeight - rect.top + 14
            : undefined,
        left: Math.min(Math.max(16, rect.left), window.innerWidth - 360),
      }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[90]">
      {/* Dim layer with spotlight cutout */}
      {rect ? (
        <div
          className="absolute rounded-xl ring-2 ring-brand-400/70 transition-all duration-300"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/72" />
      )}

      {/* Tooltip card */}
      <div className="animate-rise w-[340px] max-w-[calc(100vw-32px)]" style={tooltipStyle}>
        <div className="rounded-2xl border border-line bg-raised p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-base font-bold text-white">{s.title}</h3>
            <button onClick={finish} className="cursor-pointer rounded p-0.5 text-zinc-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1.5">
              {TOUR_STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === step ? "w-5 bg-brand-400" : "w-1.5 bg-white/15"
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {!isLast && (
                <button onClick={finish} className="cursor-pointer px-2 text-xs text-zinc-500 hover:text-white">
                  Skip
                </button>
              )}
              <Button
                className="px-3 py-1.5 text-xs"
                onClick={() => (isLast ? finish() : setStep(step + 1))}
              >
                {isLast ? "Finish" : "Next"} {!isLast && <ArrowRight className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
