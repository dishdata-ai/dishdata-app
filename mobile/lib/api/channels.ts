import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demo, uid } from "@/lib/demo";
import type { ChannelOrder, ChannelProvider } from "@/lib/types";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://app.dishdata.de";

export const PROVIDER_LABEL: Record<ChannelProvider, string> = {
  wolt: "Wolt",
  ubereats: "Uber Eats",
  lieferando: "Lieferando",
  sumup: "SumUp",
};

export const PROVIDER_COLOR: Record<ChannelProvider, string> = {
  wolt: "#00c2e8",
  ubereats: "#06c167",
  lieferando: "#ff8000",
  sumup: "#3063e9",
};

/** Uber hands an order back to manual handling after ~11.5 minutes, so show the clock. Others have no published window. */
const ACCEPT_WINDOW_MIN: Partial<Record<ChannelProvider, number>> = { ubereats: 11.5 };

export function minutesLeft(co: ChannelOrder): number | null {
  const window = ACCEPT_WINDOW_MIN[co.provider];
  if (!window) return null;
  return window - (Date.now() - new Date(co.received_at).getTime()) / 60000;
}

export async function listChannelOrders(orgId: string, limit = 100): Promise<ChannelOrder[]> {
  if (!isSupabaseConfigured) {
    return [...demo.channelOrders].sort((a, b) => b.received_at.localeCompare(a.received_at)).slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("channel_orders")
    .select("*")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ChannelOrder[];
}

/** Accept an inbound order: the database creates the real order, fires the kitchen ticket and depletes stock. */
export async function acceptChannelOrder(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const co = demo.channelOrders.find((x) => x.id === id);
    if (!co || co.status !== "pending") return;
    const gross = co.items.reduce((s, l) => s + l.price * l.qty, 0) || co.gross;
    const orderId = uid();
    demo.orders.push({
      id: orderId, org_id: orgId, order_number: `ORD-${String(demo.orders.length + 1).padStart(4, "0")}`,
      order_type: co.order_type, table_id: null, customer_id: null, guest_name: co.customer_name || null,
      items: co.items.map((l) => ({ recipe_id: l.recipe_id ?? "", name: l.name, qty: l.qty, price: l.price })),
      subtotal: +(gross * 0.915).toFixed(2), tax: +(gross * 0.085).toFixed(2), tip: 0, total: +gross.toFixed(2),
      status: "paid", kitchen_status: "new", kitchen_notes: co.notes, source: co.provider,
      created_at: new Date().toISOString(),
    });
    co.status = "accepted";
    co.order_id = orderId;
    co.decided_at = new Date().toISOString();
    return;
  }
  const { error } = await getSupabase().rpc("accept_channel_order", { _channel_order: id });
  if (error) throw error;
}

export async function rejectChannelOrder(orgId: string, id: string, reason: string): Promise<void> {
  if (!isSupabaseConfigured) {
    const co = demo.channelOrders.find((x) => x.id === id);
    if (co) {
      co.status = "rejected";
      co.reject_reason = reason;
      co.decided_at = new Date().toISOString();
    }
    return;
  }
  const { error } = await getSupabase().rpc("reject_channel_order", { _channel_order: id, _reason: reason });
  if (error) throw error;
}

/**
 * Tell the platform what we decided. The decision here is already saved, so a failure doesn't undo it — it comes
 * back as a message so the screen can say "tap it on the platform tablet too".
 */
export async function ackChannelOrder(
  channelOrderId: string,
  action: "accept" | "deny",
  reason?: string,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: session } = await getSupabase().auth.getSession();
    const token = session.session?.access_token;
    if (!token) return "Not signed in.";
    const res = await fetch(`${API_URL}/api/channels/ack`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel_order_id: channelOrderId, action, reason }),
    });
    const body = (await res.json().catch(() => ({}))) as { acked?: boolean; error?: string };
    if (!res.ok || body.error) return body.error ?? `Platform returned ${res.status}.`;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not reach the platform.";
  }
}
