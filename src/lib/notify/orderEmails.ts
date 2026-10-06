import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notify/email";
import { getOrgBrand } from "@/lib/notify/brand";

// Confirmation to the guest and an alert to the restaurant for a website order.
// Identity (site, sender, alert address) comes from the restaurant's org_sites row; the old
// NOTIFY_SITE_URL / NOTIFY_STAFF_EMAIL / EMAIL_FROM settings are only the fallback.

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const eur = (n: number, de: boolean) => new Intl.NumberFormat(de ? "de-DE" : "en-GB", { style: "currency", currency: "EUR" }).format(n);

interface Line { name: string; qty: number; price?: number }

export async function notifyWebsiteOrder(admin: SupabaseClient, orderId: string, lang = "en"): Promise<"sent" | "skipped" | "not_found"> {
  const de = lang.startsWith("de");

  // Claim the order: only the first caller gets a row back, so the emails go out once.
  const { data: claimed } = await admin
    .from("orders")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("source", "storefront")
    .in("status", ["open", "paid"])
    .is("notified_at", null)
    .select("id, org_id, order_number, order_type, total, status, scheduled_for, guest_name, customer_id, items, reservation_id, kitchen_notes")
    .maybeSingle();
  if (!claimed) return "skipped";

  const [brand, { data: customer }, { data: reservation }] = await Promise.all([
    getOrgBrand(admin, claimed.org_id),
    claimed.customer_id ? admin.from("customers").select("name, email, phone").eq("id", claimed.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    claimed.reservation_id ? admin.from("reservations").select("party_size").eq("id", claimed.reservation_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const orgName = brand.name;
  const site = brand.siteUrl;
  const lines = (claimed.items as Line[]) ?? [];
  const when = claimed.scheduled_for
    ? new Date(claimed.scheduled_for).toLocaleString(de ? "de-DE" : "en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
    : null;
  const kind = { dine_in: de ? "Dine-in mit Vorbestellung" : "Dine-in with pre-order", takeaway: de ? "Abholung" : "Takeaway", delivery: de ? "Lieferung" : "Delivery" }[claimed.order_type as "dine_in" | "takeaway" | "delivery"];
  const paid = claimed.status === "paid";
  const link = site ? `${site}/order/${claimed.id}` : "";
  const guest = customer?.name || claimed.guest_name || (de ? "Gast" : "Guest");

  const rows = lines.map((l) => `<tr><td style="padding:4px 12px 4px 0">${esc(l.qty)}×</td><td style="padding:4px 0">${esc(l.name)}</td></tr>`).join("");
  const plain = lines.map((l) => `${l.qty}x ${l.name}`).join("\n");

  // ---- Guest
  if (customer?.email) {
    const t = de
      ? { subject: `Deine Bestellung ${claimed.order_number} bei ${orgName}`, hi: `Hallo ${guest},`, intro: when ? `danke für deine Bestellung! Wir haben alles für ${when} eingeplant.` : "danke für deine Bestellung! Wir bereiten alles für dich vor.", pay: paid ? "Bezahlt. Danke!" : "Bezahlt wird im Restaurant.", guests: "Personen", total: "Gesamt", link: "Deine Bestellung ansehen", checkin: "Wir kochen so, dass alles zu deiner Zeit fertig ist. Tippe auf der Bestellseite „Ich bin unterwegs“, damit die Küche weiß, dass du kommst." }
      : { subject: `Your order ${claimed.order_number} at ${orgName}`, hi: `Hi ${guest},`, intro: when ? `thank you for your order! We have everything planned for ${when}.` : "thank you for your order! We are getting everything ready for you.", pay: paid ? "Paid. Thank you!" : "You pay at the restaurant.", guests: "Guests", total: "Total", link: "View your order", checkin: "We cook so everything is ready at your time. On your order page, tap \"I'm on my way\" so the kitchen knows you are coming." };
    await sendEmail({
      to: customer.email,
      from: brand.from,
      replyTo: brand.replyTo,
      subject: t.subject,
      html: `<div style="font-family:Arial,sans-serif;color:#134033;max-width:520px;margin:auto"><h2 style="color:${esc(brand.primaryColor)}">${esc(orgName)}</h2><p>${esc(t.hi)}</p><p>${esc(t.intro)}</p><p><b>${esc(claimed.order_number)}</b> · ${esc(kind)}${reservation?.party_size ? ` · ${esc(reservation.party_size)} ${esc(t.guests)}` : ""}</p><table style="border-collapse:collapse">${rows}</table><p><b>${esc(t.total)}: ${esc(eur(Number(claimed.total), de))}</b><br>${esc(t.pay)}</p>${claimed.scheduled_for ? `<p>${esc(t.checkin)}</p>` : ""}${link ? `<p><a href="${esc(link)}" style="background:${esc(brand.primaryColor)};color:#fff;padding:10px 20px;border-radius:99px;text-decoration:none;font-weight:bold">${esc(t.link)}</a></p>` : ""}</div>`,
      text: `${t.hi}\n\n${t.intro}\n\n${claimed.order_number} · ${kind}${reservation?.party_size ? ` · ${reservation.party_size} ${t.guests}` : ""}\n${plain}\n\n${t.total}: ${eur(Number(claimed.total), de)}\n${t.pay}${link ? `\n\n${t.link}: ${link}` : ""}`,
    });
  }

  // ---- Restaurant
  // The alert can go to several people: separate addresses with commas in the Website & brand card.
  const staff = brand.staffEmail?.split(/[,;\s]+/).filter((e) => e.includes("@"));
  if (staff && staff.length) {
    await sendEmail({
      to: staff,
      from: brand.from,
      replyTo: brand.replyTo,
      subject: `Website order ${claimed.order_number}${when ? ` for ${when}` : ""}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px"><h3>New website order ${esc(claimed.order_number)}</h3><p>${esc(kind)}${when ? ` · ${esc(when)}` : ""}${reservation?.party_size ? ` · ${esc(reservation.party_size)} guests` : ""}<br>${esc(guest)}${customer?.phone ? ` · ${esc(customer.phone)}` : ""}${customer?.email ? ` · ${esc(customer.email)}` : ""}</p><table style="border-collapse:collapse">${rows}</table><p><b>${esc(eur(Number(claimed.total), false))}</b> · ${paid ? "PAID online" : "pay at the restaurant"}</p>${claimed.kitchen_notes ? `<p>${esc(claimed.kitchen_notes)}</p>` : ""}</div>`,
      text: `New website order ${claimed.order_number}\n${kind}${when ? ` · ${when}` : ""}\n${guest}${customer?.phone ? ` · ${customer.phone}` : ""}\n${plain}\n${eur(Number(claimed.total), false)} · ${paid ? "PAID online" : "pay at the restaurant"}\n${claimed.kitchen_notes ?? ""}`,
    });
  }
  return "sent";
}

/** The guest confirmed they are on their way: tell the kitchen (once, right after the tap). */
export async function notifyCheckIn(admin: SupabaseClient, orderId: string): Promise<"sent" | "skipped"> {
  const { data: o } = await admin
    .from("orders")
    .select("org_id, order_number, guest_name, scheduled_for, checked_in_at, source")
    .eq("id", orderId)
    .maybeSingle();
  // Only a fresh tap on a website order; a repeated call must not email again.
  if (!o || o.source !== "storefront" || !o.checked_in_at || !o.scheduled_for) return "skipped";
  if (Date.now() - new Date(o.checked_in_at).getTime() > 2 * 60_000) return "skipped";
  const brand = await getOrgBrand(admin, o.org_id);
  const staff = brand.staffEmail?.split(/[,;\s]+/).filter((e) => e.includes("@"));
  if (!staff || !staff.length) return "skipped";
  const at = new Date(o.scheduled_for).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
  await sendEmail({
    to: staff,
    from: brand.from,
    replyTo: brand.replyTo,
    subject: `On the way: ${o.order_number} for ${at}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:480px"><h3>${esc(o.guest_name ?? "Guest")} confirmed they are coming</h3><p>${esc(o.order_number)} for <b>${esc(at)}</b>. Cook from the usual start time.</p></div>`,
    text: `${o.guest_name ?? "Guest"} confirmed they are coming.\n${o.order_number} for ${at}.`,
  });
  return "sent";
}
