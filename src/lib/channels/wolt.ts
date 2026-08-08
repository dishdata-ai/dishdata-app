import { createHmac } from "node:crypto";
import {
  type ChannelAdapter, type ParsedLine,
  obj, str, num, arr, fromMinor, timingSafeEqual,
} from "@/lib/channels/types";

/**
 * Wolt — Marketplace order integration (iPad-free / POS).
 *
 * Like Uber, the webhook is a NOTIFICATION rather than the order:
 *   { id, type: "order.notification",
 *     order: { id, venue_id, status, resource_url }, created_at }
 * The order itself is fetched from `order.resource_url`.
 *
 * Signature: hex HMAC-SHA256 of the raw body keyed with the webhook client
 * secret, in the `WOLT-SIGNATURE` header (note: no `X-` prefix — unlike almost
 * every other platform, and easy to get wrong).
 *
 * Wolt expects a 200; without one it retries 3 times at 5-second intervals.
 *
 * Money is in minor units. Quantity is `count`, not `quantity`.
 *
 * Docs: developer.wolt.com/docs/webhook + /docs/api/order
 */
function items(payload: Record<string, unknown>): ParsedLine[] {
  return arr(payload.items).map((entry) => {
    const it = obj(entry);
    const unit = obj(it.unit_price);
    // Options are {name, value} pairs, e.g. {name: "In the burger", value: "Cheese"}.
    const opts = arr(it.options)
      .map((o) => {
        const op = obj(o);
        return [str(op.name), str(op.value)].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    return {
      name: str(it.name, "Item"),
      qty: num(it.count, num(it.quantity, 1)),
      price: unit.amount !== undefined ? fromMinor(unit.amount) : fromMinor(it.unit_price),
      notes: [...opts, str(it.comment)].filter(Boolean).join(" · ") || null,
    };
  });
}

export const wolt: ChannelAdapter = {
  provider: "wolt",
  label: "Wolt",

  verify({ raw, headers, secret }) {
    // Wolt sends `WOLT-SIGNATURE` — not `X-Wolt-Signature`.
    const sig = headers.get("wolt-signature");
    if (!sig) return "Missing WOLT-SIGNATURE header.";
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    return timingSafeEqual(sig.trim().toLowerCase(), expected) ? null : "Signature mismatch.";
  },

  storeIdOf(payload) {
    const p = obj(payload);
    // Notification: order.venue_id. Fetched order: venue.id.
    return str(obj(p.order).venue_id, str(obj(p.venue).id, str(p.venue_id)));
  },

  isNewOrder(payload) {
    const p = obj(payload);
    const status = str(obj(p.order).status, str(p.order_status)).toUpperCase();
    if (str(p.type).toLowerCase() === "order.notification") {
      // Wolt reuses one notification type for the whole lifecycle — CREATED,
      // PRODUCTION, READY, DELIVERED, CANCELED. Only CREATED is a new order.
      return status === "CREATED" || status === "";
    }
    // Venue events (REJECTION_ALERT_TRIGGERED, OPENING_HOURS_UPDATED, …).
    if (p.event_type) return false;
    return arr(p.items).length > 0;
  },

  fetchUrlOf(payload) {
    const p = obj(payload);
    if (arr(p.items).length) return null; // already the full order
    return str(obj(p.order).resource_url) || null;
  },

  parse(payload) {
    const p = obj(payload);
    const externalId = str(p.id, str(p.order_id));
    if (!externalId) throw new Error("Wolt payload has no order id.");
    const lines = items(p);
    if (!lines.length) throw new Error("Wolt order carried no line items.");

    const price = obj(p.price);
    const delivery = obj(p.delivery);
    // homedelivery | pickup | self_delivery
    const type = str(delivery.type, str(p.type)).toLowerCase();

    return {
      externalId,
      displayId: str(p.order_number, str(p.pickup_code, externalId.slice(-6))),
      storeId: wolt.storeIdOf(payload),
      customerName: str(p.consumer_name, str(obj(p.consumer).name)),
      orderType: type.includes("pickup") ? "takeaway" : "delivery",
      lines,
      gross: price.amount !== undefined
        ? fromMinor(price.amount)
        : lines.reduce((s, l) => s + l.price * l.qty, 0),
      notes: str(p.consumer_comment, str(p.comment)) || null,
      fulfillment: {
        type,
        address: str(obj(delivery.location).formatted_address, str(delivery.address)),
        pickup_eta: str(p.pickup_eta, str(p.preorder_time)) || null,
      },
    };
  },
};
