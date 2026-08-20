import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Org } from "@/lib/types";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://app.dishdata.de";

/**
 * Receipt-printer settings, stored on `org.settings.printer` — the same shape
 * the web app writes, so a printer configured once in Settings works on every
 * device without being set up again here.
 */
export interface PrinterConfig {
  host: string;
  enabled: boolean;
  columns: number;
  openDrawer: boolean;
}

export const DEFAULT_PRINTER: PrinterConfig = {
  host: "",
  enabled: false,
  columns: 48,
  openDrawer: false,
};

export function getPrinterConfig(org: Org | null | undefined): PrinterConfig {
  const raw = (org?.settings as Record<string, unknown> | undefined)?.printer;
  if (!raw || typeof raw !== "object") return DEFAULT_PRINTER;
  const p = raw as Partial<PrinterConfig>;
  return {
    host: typeof p.host === "string" ? p.host : "",
    enabled: !!p.enabled,
    columns: typeof p.columns === "number" && p.columns > 0 ? p.columns : 48,
    openDrawer: !!p.openDrawer,
  };
}

export function isPrinterReady(org: Org | null | undefined): boolean {
  const c = getPrinterConfig(org);
  return c.enabled && c.host.trim().length > 0;
}

export interface PrintResult {
  ok: boolean;
  receiptNumber?: string;
  message: string;
}

/**
 * Print a Beleg for a PAID order on the restaurant's thermal printer.
 *
 * The receipt payload is rendered server-side (one implementation of the
 * layout and the per-rate VAT rules, shared with the web app), then posted
 * from the device to the printer's ePOS-Print service over the local network.
 *
 * Unlike the browser, a native app can talk to a plain-HTTP device on the LAN,
 * so there's no certificate to install here — see app.json for the cleartext
 * and local-network permissions that allows.
 */
export async function printReceipt(orderId: string, org: Org): Promise<PrintResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, message: "Drucken benötigt eine Verbindung zum Backend." };
  }
  const cfg = getPrinterConfig(org);
  if (!cfg.host.trim()) {
    return { ok: false, message: "Kein Drucker konfiguriert (Einstellungen → Receipt Printer)." };
  }

  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: "Nicht angemeldet." };

  let xml: string;
  let receiptNumber: string | undefined;
  try {
    const res = await fetch(`${API_URL}/api/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        order_id: orderId,
        format: "epos",
        columns: cfg.columns,
        openDrawer: cfg.openDrawer,
      }),
    });
    const bodyJson = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: bodyJson.error || `Beleg-Fehler (${res.status})` };
    if (!bodyJson.epos) return { ok: false, message: "Kein Druckauftrag erhalten." };
    xml = bodyJson.epos as string;
    receiptNumber = bodyJson.receiptNumber as string;
  } catch {
    return { ok: false, message: "Beleg konnte nicht erstellt werden." };
  }

  const host = cfg.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const endpoint = `http://${host}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;

  try {
    // The printer is on the local network and can be slow to answer when busy;
    // without a bound this would hang the button indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
      body: xml,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, receiptNumber, message: `Drucker antwortete ${res.status}` };
    const text = await res.text();
    if (!/success="true"/.test(text)) {
      const code = text.match(/code="([^"]*)"/)?.[1];
      return { ok: false, receiptNumber, message: code ? `Druckerfehler: ${code}` : "Drucker hat abgelehnt." };
    }
    return { ok: true, receiptNumber, message: `Bon gedruckt${receiptNumber ? ` · ${receiptNumber}` : ""}` };
  } catch {
    return {
      ok: false,
      receiptNumber,
      message: `Drucker ${host} nicht erreichbar. Gleiches WLAN?`,
    };
  }
}
