import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { notifyWebsiteOrder } from "@/lib/notify/orderEmails";

/**
 * POST /api/notify/order   { orderId, lang? }   header: x-notify-secret
 * Called by the website's server right after a pay-at-restaurant order. Paid
 * (Stripe) orders are announced by the payments webhook instead, once the money
 * has arrived. Safe to call twice: the order is stamped, so emails go out once.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret || req.headers.get("x-notify-secret") !== secret) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });

  let body: { orderId?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.orderId || !UUID.test(body.orderId)) return NextResponse.json({ error: "Invalid order." }, { status: 400 });

  const result = await notifyWebsiteOrder(admin, body.orderId, body.lang ?? "en");
  return NextResponse.json({ result });
}
