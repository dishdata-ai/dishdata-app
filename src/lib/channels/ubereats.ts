import { createHmac } from "node:crypto";
import {
  type ChannelAdapter, type ParsedOrder, type ParsedLine,
  obj, str, num, arr, fromMinor, timingSafeEqual,
} from "@/lib/channels/types";

/**
 * Uber Eats — Marketplace order integration.
 *
 * The webhook is a NOTIFICATION, not the order:
 *   { event_type: "orders.notification", event_id, event_time,
 *     meta: { resource_id, status, user_id }, resource_href }
 * where `meta.resource_id` is the order id, `meta.user_id` is the STORE id,
 * and `resource_href` is the GET endpoint for the order itself
 * (https://api.uber.com/v2/eats/order/{order_id}).
 *
 * Signature: lowercase hex HMAC-SHA256 of the raw body keyed with the client
 * secret, in `X-Uber-Signature`.
 *
 * The endpoint must return 200 with an EMPTY body; Uber otherwise retries with
 * exponential backoff (1s/2s/4s, up to 7 attempts). After acknowledging, the
 * order must be accepted or denied within ~11.5 minutes or it auto-cancels.
 *
 * Docs: developer.uber.com/docs/eats/references/api/webhooks.orders-notification
 */
function items(payload: Record<string, unknown>): ParsedLine[] {
  const p = obj(payload);
  // v2 uses a single `cart` object; older/other shapes use `carts[]` or a
  // bare `items[]`. Accept all three rather than guessing one.
  const cart = obj(p.cart);
  const raw = arr(cart.items).length
    ? arr(cart.items)
    : arr(p.carts).length
      ? arr(p.carts).flatMap((c) => arr(obj(c).items))
      : arr(p.items);

  return raw.map((entry) => {
    const it = obj(entry);
    const price = obj(it.price);
    const unit = obj(price.unit_price);
    const amount = unit.amount !== undefined
      ? fromMinor(unit.amount)
      : price.unit_price !== undefined
        ? fromMinor(price.unit_price)
        : fromMinor(it.unit_price);
    const mods = arr(it.selected_modifier_groups)
      .flatMap((g) => arr(obj(g).selected_items))
      .map((m) => str(obj(m).title))
      .filter(Boolean);
    return {
      name: str(it.title, str(it.name, "Item")),
      qty: num(it.quantity, 1),
      price: amount,
      notes: [str(it.special_instructions), ...mods].filter(Boolean).join(" · ") || null,
    };
  });
}

export const ubereats: ChannelAdapter = {
  provider: "ubereats",
  label: "Uber Eats",

  verify({ raw, headers, secret }) {
    const sig = headers.get("x-uber-signature");
    if (!sig) return "Missing X-Uber-Signature header.";
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    return timingSafeEqual(sig.trim().toLowerCase(), expected) ? null : "Signature mismatch.";
  },

  storeIdOf(payload) {
    const p = obj(payload);
    // On a notification the store is meta.user_id; a fetched order has store.id.
    return str(obj(p.meta).user_id, str(obj(p.store).id, str(p.store_id)));
  },

  isNewOrder(payload) {
    const p = obj(payload);
    const type = str(p.event_type).toLowerCase();
    // Only the order-placed notification creates an order. Anything else
    // (cancellations, fulfillment updates, report callbacks) is acknowledged
    // and ignored so it cannot create phantom tickets.
    if (type) return type === "orders.notification";
    // No event_type at all: a full order resource posted directly.
    return Boolean(p.cart || p.carts || p.items);
  },

  fetchUrlOf(payload) {
    const p = obj(payload);
    if (p.cart || p.carts || p.items) return null; // already the full order
    const href = str(p.resource_href);
    if (href) return href;
    const id = str(obj(p.meta).resource_id, str(p.id));
    return id ? `https://api.uber.com/v2/eats/order/${encodeURIComponent(id)}` : null;
  },

  parse(payload) {
    const p = obj(payload);
    const externalId = str(p.id, str(obj(p.meta).resource_id));
    if (!externalId) throw new Error("Uber Eats payload has no order id.");
    const lines = items(p);
    if (!lines.length) throw new Error("Uber Eats order carried no line items.");

    const payment = obj(p.payment);
    const total = obj(obj(payment.charges).total);
    const eater = obj(p.eater);
    // PICK_UP | DINE_IN | DELIVERY_BY_UBER | DELIVERY_BY_RESTAURANT
    const type = str(p.type, str(obj(p.fulfillment).type)).toUpperCase();

    const order: ParsedOrder = {
      externalId,
      displayId: str(p.display_id, externalId.slice(-6)),
      storeId: ubereats.storeIdOf(payload),
      customerName: [str(eater.first_name), str(eater.last_name)].filter(Boolean).join(" "),
      orderType: type.includes("PICK") ? "takeaway" : type.includes("DINE") ? "dine_in" : "delivery",
      lines,
      gross: total.amount !== undefined
        ? fromMinor(total.amount)
        : lines.reduce((s, l) => s + l.price * l.qty, 0),
      notes: str(obj(p.cart).special_instructions, str(p.special_instructions)) || null,
      fulfillment: {
        type,
        address: str(obj(obj(arr(p.deliveries)[0]).location).address,
          str(obj(obj(p.delivery).location).address)),
        estimated_ready_at: str(p.estimated_ready_for_pickup_at) || null,
      },
    };
    return order;
  },
};
