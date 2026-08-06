import { createHmac } from "node:crypto";
import {
  type ChannelAdapter, type ParsedOrder, type ParsedLine,
  obj, str, num, arr, fromMinor, timingSafeEqual,
} from "@/lib/channels/types";

/**
 * Uber Eats — Eats Marketplace "order.notification" webhook.
 *
 * Signature: hex HMAC-SHA256 of the raw body, keyed with the client secret,
 * sent as `X-Uber-Signature`.
 *
 * Uber can deliver either the full order resource or (on some integration
 * tiers) only a reference with `meta.resource_id`, expecting a follow-up
 * authenticated GET. We parse the full-resource form; a reference-only payload
 * throws, and the route stores it as `failed` with the raw body intact so it
 * can be replayed once order-fetch credentials are wired.
 */
function items(payload: Record<string, unknown>): ParsedLine[] {
  // Full resource: carts[].items[]. Older/simpler shape: items[] at the root.
  const carts = arr(payload.carts);
  const raw = carts.length
    ? carts.flatMap((c) => arr(obj(c).items))
    : arr(payload.items);

  return raw.map((entry) => {
    const it = obj(entry);
    const price = obj(it.price);
    // `unit_price` is an amount object in minor units; some payloads inline it.
    const unit = obj(price.unit_price);
    const amount = unit.amount !== undefined ? fromMinor(unit.amount)
      : price.unit_price !== undefined ? fromMinor(price.unit_price)
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
    return str(obj(p.store).id, str(obj(p.meta).store_id, str(p.store_id)));
  },

  parse(payload) {
    const p = obj(payload);
    const externalId = str(p.id, str(obj(p.meta).resource_id));
    if (!externalId) throw new Error("Uber Eats payload has no order id.");
    const lines = items(p);
    if (!lines.length) {
      throw new Error(
        "Uber Eats payload carried no line items — likely a notification-only " +
        "event requiring an authenticated order fetch. Stored raw for replay.",
      );
    }

    const payment = obj(p.payment);
    const total = obj(obj(payment.charges).total);
    const eater = obj(p.eater);
    // DELIVERY_BY_UBER | DELIVERY_BY_RESTAURANT | PICK_UP
    const type = str(p.type, str(obj(p.fulfillment).type)).toUpperCase();

    const order: ParsedOrder = {
      externalId,
      displayId: str(p.display_id, externalId.slice(-6)),
      storeId: ubereats.storeIdOf(payload),
      customerName: [str(eater.first_name), str(eater.last_name)].filter(Boolean).join(" "),
      orderType: type.includes("PICK") ? "takeaway" : "delivery",
      lines,
      gross: total.amount !== undefined
        ? fromMinor(total.amount)
        : lines.reduce((s, l) => s + l.price * l.qty, 0),
      notes: str(p.special_instructions) || null,
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
