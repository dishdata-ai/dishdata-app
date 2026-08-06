import { createHmac } from "node:crypto";
import {
  type ChannelAdapter, type ParsedLine,
  obj, str, num, arr, fromMinor, timingSafeEqual,
} from "@/lib/channels/types";

/**
 * Wolt — Merchant API order push ("order injection").
 *
 * Signature: hex HMAC-SHA256 of the raw body keyed with the shared secret, in
 * `X-Wolt-Signature`. Wolt quotes money in minor units and calls a location a
 * "venue".
 */
function items(payload: Record<string, unknown>): ParsedLine[] {
  return arr(payload.items).map((entry) => {
    const it = obj(entry);
    const unit = obj(it.unit_price);
    // Wolt nests options under `options[].value`; flatten them into the note
    // so the line still reads correctly on the kitchen ticket.
    const opts = arr(it.options)
      .map((o) => {
        const op = obj(o);
        return [str(op.name), str(op.value)].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    return {
      name: str(it.name, "Item"),
      // Wolt uses `count` for quantity.
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
    const sig = headers.get("x-wolt-signature");
    if (!sig) return "Missing X-Wolt-Signature header.";
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    return timingSafeEqual(sig.trim().toLowerCase(), expected) ? null : "Signature mismatch.";
  },

  storeIdOf(payload) {
    const p = obj(payload);
    return str(obj(p.venue).id, str(p.venue_id, str(obj(p.store).id)));
  },

  parse(payload) {
    const p = obj(payload);
    const externalId = str(p.id, str(p.order_id));
    if (!externalId) throw new Error("Wolt payload has no order id.");
    const lines = items(p);
    if (!lines.length) throw new Error("Wolt payload carried no line items.");

    const price = obj(p.price);
    const delivery = obj(p.delivery);
    // Wolt: "homedelivery" | "takeaway" | "eatin"
    const type = str(delivery.type, str(p.type)).toLowerCase();
    const consumer = obj(p.consumer);

    return {
      externalId,
      displayId: str(p.order_number, str(p.pickup_code, externalId.slice(-6))),
      storeId: wolt.storeIdOf(payload),
      customerName: str(p.consumer_name, str(consumer.name, str(consumer.first_name))),
      orderType: type.includes("home") || type.includes("deliv") ? "delivery" : "takeaway",
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
