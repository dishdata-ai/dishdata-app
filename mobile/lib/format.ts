import { demo } from "@/lib/demo";

// The active org's currency. Defaults to the demo org's until a real org loads;
// OrgProvider calls setActiveCurrency() so every money() call across the app
// formats in the signed-in org's currency (e.g. EUR for Kokoland) — not USD.
let activeCurrency = demo.org.currency;

export function setActiveCurrency(currency: string | null | undefined): void {
  activeCurrency = currency || demo.org.currency;
}

export function money(n: number, currency = activeCurrency): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

/** "3h 24m" style elapsed label from an ISO start to now (or to `end`). */
export function elapsed(startISO: string, endISO?: string | null): string {
  const ms = (endISO ? new Date(endISO).getTime() : Date.now()) - new Date(startISO).getTime();
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function agoMins(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
