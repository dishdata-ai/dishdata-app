import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase-admin";
import { notifyCheckIn } from "@/lib/notify/orderEmails";

/** POST /api/notify/checkin  { orderId }  header x-notify-secret. Emails the kitchen that a guest is on their way. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_SECRET;
  if (!secret || req.headers.get("x-notify-secret") !== secret) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Backend unavailable." }, { status: 500 });
  const body = (await req.json().catch(() => ({}))) as { orderId?: string };
  if (!body.orderId || !UUID.test(body.orderId)) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  return NextResponse.json({ result: await notifyCheckIn(admin, body.orderId) });
}
