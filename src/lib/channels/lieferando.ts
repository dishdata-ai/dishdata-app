import { createHmac } from "node:crypto";
import {
  type ChannelAdapter, type ParsedLine,
  obj, str, num, arr, timingSafeEqual,
} from "@/lib/channels/types";

/**
 * Lieferando — Just Eat Takeaway.com POS/partner order push.
 *
 * Signature: base64 HMAC-SHA256 of the raw body in `X-Je-Signature`. Unlike
 * Uber and Wolt, JET quotes money in MAJOR units (decimal euros) as strings,
 * so no minor-unit conversion here — a mistake worth keeping in mind if this
 * file is ever copied from one of the others.
 */
function items(payload: Record<string, unknown>): ParsedLine[] {
  const raw = arr(payload.items).length ? arr(payload.items) : arr(payload.orderItems);
  return raw.map((entry) => {
    const it = obj(entry);
    const mods = arr(it.options).length ? arr(it.options) : arr(it.modifiers);
    const opts = mods.map((m) => str(obj(m).name)).filter(Boolean);
    return {
      name: str(it.name, str(it.productName, "Item")),
      qty: num(it.quantity, num(it.count, 1)),
      // Already decimal euros — do NOT divide by 100.
      price: num(it.unitPrice, num(it.price)),
      notes: [...opts, str(it.remarks)].filter(Boolean).join(" · ") || null,
    };
  });
}

export const lieferando: ChannelAdapter = {
  provider: "lieferando",
  label: "Lieferando",

  verify({ raw, headers, secret }) {
    const sig = headers.get("x-je-signature");
    if (!sig) return "Missing X-Je-Signature header.";
    const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    return timingSafeEqual(sig.trim(), expected) ? null : "Signature mismatch.";
  },

  storeIdOf(payload) {
    const p = obj(payload);
    return str(p.restaurantId, str(obj(p.restaurant).id, str(p.storeId)));
  },

  isNewOrder(payload) {
    const p = obj(payload);
    // Unlike Wolt/Uber, JET's exact event envelope is not public; treat any
    // payload carrying lines as a new order and ignore bare status pings.
    return arr(p.items).length > 0 || arr(p.orderItems).length > 0;
  },

  /** JET posts the order itself — nothing to fetch. */
  fetchUrlOf() {
    return null;
  },

  parse(payload) {
    const p = obj(payload);
    const externalId = str(p.orderId, str(p.id, str(p.publicReference)));
    if (!externalId) throw new Error("Lieferando payload has no order id.");
    const lines = items(p);
    if (!lines.length) throw new Error("Lieferando payload carried no line items.");

    const customer = obj(p.customer);
    // JET: "delivery" | "pickup"
    const type = str(p.deliveryType, str(p.serviceType, str(p.orderType))).toLowerCase();
    const address = obj(customer.address).street !== undefined
      ? [str(obj(customer.address).street), str(obj(customer.address).city)].filter(Boolean).join(", ")
      : str(p.deliveryAddress);

    return {
      externalId,
      displayId: str(p.publicReference, str(p.orderNumber, externalId.slice(-6))),
      storeId: lieferando.storeIdOf(payload),
      customerName: str(customer.name,
        [str(customer.firstName), str(customer.lastName)].filter(Boolean).join(" ")),
      orderType: type.startsWith("pick") || type.startsWith("collect") ? "takeaway" : "delivery",
      lines,
      gross: num(p.totalPrice, num(p.total, lines.reduce((s, l) => s + l.price * l.qty, 0))),
      notes: str(p.remarks, str(p.note)) || null,
      fulfillment: {
        type,
        address,
        requested_time: str(p.requestedDeliveryTime, str(p.deliveryTime)) || null,
      },
    };
  },
};
