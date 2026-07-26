import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/**
 * Base URL of the DishData web app that hosts /api/receipts (which does the
 * atomic receipt numbering, German HTML rendering, and Resend send server-side).
 * The mobile app can't send email itself — the Resend key must stay off-device.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://app.dishdata.de";

export interface SendReceiptResult {
  ok: boolean;
  receiptNumber?: string;
  message: string;
}

/**
 * Email a German Beleg for a PAID order to the customer. Auth travels as the
 * signed-in employee's Supabase access token (the route verifies membership).
 */
export async function emailReceipt(orderId: string, email: string): Promise<SendReceiptResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, message: "Belege benötigen eine Verbindung zum Backend." };
  }

  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: "Nicht angemeldet." };

  try {
    const res = await fetch(`${API_URL}/api/receipts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ order_id: orderId, email: email.trim(), send: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: body.error || `Fehler (${res.status})` };
    }
    if (body.emailed) {
      return { ok: true, receiptNumber: body.receiptNumber, message: `Beleg an ${email.trim()} gesendet` };
    }
    return { ok: false, receiptNumber: body.receiptNumber, message: body.emailError || "E-Mail ist noch nicht konfiguriert." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Netzwerkfehler" };
  }
}
