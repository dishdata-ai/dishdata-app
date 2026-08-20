import type { Org } from "@/lib/api/database.types";

/**
 * Receipt-printer configuration, stored on `org.settings` rather than its own
 * column — it's per-restaurant operational config that changes when someone
 * swaps a printer, not something reports or RPCs ever query.
 */
export interface PrinterConfig {
  /** Printer IP or hostname on the restaurant LAN, e.g. "192.168.1.50". */
  host: string;
  /** Off = fall back to the browser print dialog. */
  enabled: boolean;
  /**
   * ePOS-Print over HTTPS. Required when DishData is served over HTTPS, since
   * browsers block an HTTPS page from calling a plain-HTTP address.
   */
  useHttps: boolean;
  /** 48 for an 80mm roll, 32 for 58mm. */
  columns: number;
  /** Pop the cash drawer when a receipt prints. */
  openDrawer: boolean;
}

export const DEFAULT_PRINTER: PrinterConfig = {
  host: "",
  enabled: false,
  useHttps: true,
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
    useHttps: p.useHttps !== false,
    columns: typeof p.columns === "number" && p.columns > 0 ? p.columns : 48,
    openDrawer: !!p.openDrawer,
  };
}

/** Configured and switched on — i.e. we should try the printer before the dialog. */
export function isPrinterReady(org: Org | null | undefined): boolean {
  const c = getPrinterConfig(org);
  return c.enabled && c.host.trim().length > 0;
}
