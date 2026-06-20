import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtCurrency = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);

export const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

export const fmtNumber = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Extracts a human-readable message from any thrown value. Supabase PostgrestError
 *  objects are plain objects (not Error instances), so `instanceof Error` misses them. */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; hint?: unknown; details?: unknown };
    const parts = [o.message, o.details, o.hint].filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    if (parts.length) return parts.join(" — ");
  }
  return fallback;
}
