// Shared contract for the delivery-platform adapters (Uber Eats / Wolt /
// Lieferando). Each platform has its own payload shape, auth scheme and
// webhook signature; an adapter's whole job is to hide those differences
// behind `verify()` + `parse()` so the ingest route stays platform-agnostic.
//
// SCOPE NOTE: these adapters are written against each platform's published
// integration docs. All three require a signed partner agreement and a
// certification pass before they will send live traffic, and every one of them
// reserves the right to add fields. Treat the field mappings as a starting
// point to be confirmed against real sandbox payloads during certification —
// `raw` is persisted on every inbound order precisely so a mis-parse can be
// re-read and replayed rather than lost.

import type { ChannelProvider, OrderType } from "@/lib/api/database.types";

/** A line as the platform sent it, before we resolve it to one of our recipes. */
export interface ParsedLine {
  name: string;
  qty: number;
  /** Unit price the guest paid, in major units (EUR), VAT included. */
  price: number;
  notes?: string | null;
}

/** Platform payload normalized into the shape `channel_orders` stores. */
export interface ParsedOrder {
  /** The platform's order id — our idempotency key. */
  externalId: string;
  /** Short code the courier or guest quotes. */
  displayId: string;
  /** The platform's id for the location, used to route to the right org. */
  storeId: string;
  customerName: string;
  orderType: OrderType;
  lines: ParsedLine[];
  /** Order total in major units (EUR), VAT included, as the guest paid it. */
  gross: number;
  notes: string | null;
  fulfillment: Record<string, unknown>;
}

export interface VerifyInput {
  /** Raw request body, unparsed — signatures are computed over the exact bytes. */
  raw: string;
  headers: Headers;
  /** The channel's `webhook_secret`. */
  secret: string;
}

export interface ChannelAdapter {
  provider: ChannelProvider;
  label: string;
  /**
   * Verify the request really came from the platform. Returns an error string
   * when it did not; undefined/null means verified.
   */
  verify(input: VerifyInput): string | null;
  /** Pull the platform's store id out of a payload before the channel is known. */
  storeIdOf(payload: unknown): string;
  /**
   * True when this webhook is a NEW order to ingest. Both Wolt and Uber send
   * the same endpoint many non-order events (status changes, courier updates,
   * venue alerts); those must be acknowledged and ignored, not parsed.
   */
  isNewOrder(payload: unknown): boolean;
  /**
   * Absolute URL to GET the full order. Both platforms send a notification
   * carrying only an id, so this is the normal path — null means the payload
   * already contains the order.
   */
  fetchUrlOf(payload: unknown): string | null;
  /** Normalize. Throws with a readable message when the payload is unusable. */
  parse(payload: unknown): ParsedOrder;
}

// --- helpers shared by the adapters ----------------------------------------

/** Narrow an unknown payload to an indexable object without `any`. */
export function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Platforms quote money in minor units (cents). Convert to major units. */
export function fromMinor(v: unknown): number {
  return Math.round(num(v)) / 100;
}

/**
 * Constant-time string compare, so a bad signature cannot be brute-forced by
 * timing the response.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
