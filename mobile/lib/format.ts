import { demo } from "@/lib/demo";

export function money(n: number, currency = demo.org.currency): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
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
