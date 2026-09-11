import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  Channel, ChannelSafe, ChannelOrder, ChannelProvider,
} from "@/lib/api/database.types";

const dChannels = demoTable<Channel>("channels");
const dChannelOrders = demoTable<ChannelOrder>("channel_orders");
const dOrders = demoTable<{ id: string; org_id: string }>("orders");

/**
 * Columns safe to send to the browser — deliberately excludes `credentials`.
 * RLS already limits the row to owner/admin; this keeps the secret material
 * off the wire even for them.
 */
const SAFE_COLUMNS =
  "id, org_id, provider, external_store_id, is_active, webhook_secret, auto_accept, " +
  "prep_minutes, commission_pct, price_markup_pct, send_to_kitchen, settings, " +
  "has_credentials, last_order_at, last_error, last_error_at, created_at, updated_at, created_by";

function toSafe(row: Channel): ChannelSafe {
  const { credentials, ...rest } = row;
  return { ...rest, has_credentials: Object.keys(credentials ?? {}).length > 0 };
}

export async function listChannels(orgId: string): Promise<ChannelSafe[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dChannels.list({ org_id: orgId } as Partial<Channel>).map(toSafe);
  }
  // `credentials` is never selected; the DB reports presence via the
  // has_credentials generated column instead.
  const { data, error } = await getSupabase()
    .from("channels")
    .select(SAFE_COLUMNS)
    .eq("org_id", orgId);
  if (error) throw error;
  return (data ?? []) as unknown as ChannelSafe[];
}

export interface ConnectChannelInput {
  provider: ChannelProvider;
  externalStoreId: string;
  /** Platform API credentials — written, never read back. */
  credentials?: Record<string, unknown>;
  autoAccept?: boolean;
  sendToKitchen?: boolean;
  settings?: Record<string, unknown>;
}

/** Create (or re-point) the org's channel for a provider. */
export async function connectChannel(orgId: string, input: ConnectChannelInput): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const existing = dChannels
      .list({ org_id: orgId } as Partial<Channel>)
      .find((c) => c.provider === input.provider);
    if (existing) {
      dChannels.update(existing.id, {
        external_store_id: input.externalStoreId,
        credentials: input.credentials ?? existing.credentials,
        auto_accept: input.autoAccept ?? existing.auto_accept,
        send_to_kitchen: input.sendToKitchen ?? existing.send_to_kitchen,
        settings: input.settings ?? existing.settings,
      });
      return existing.id;
    }
    const now = new Date().toISOString();
    const row: Channel = {
      id: uid(), org_id: orgId, provider: input.provider,
      external_store_id: input.externalStoreId,
      is_active: true,
      credentials: input.credentials ?? {},
      webhook_secret: uid().replace(/-/g, "") + uid().replace(/-/g, ""),
      auto_accept: input.autoAccept ?? false, prep_minutes: 20, commission_pct: 30,
      price_markup_pct: 0, send_to_kitchen: input.sendToKitchen ?? true,
      settings: input.settings ?? {},
      last_order_at: null, last_error: null, last_error_at: null,
      created_at: now, updated_at: now, created_by: null,
    };
    dChannels.insert(row);
    return row.id;
  }
  const { data, error } = await getSupabase()
    .from("channels")
    .upsert(
      {
        org_id: orgId,
        provider: input.provider,
        external_store_id: input.externalStoreId,
        is_active: true,
        ...(input.credentials ? { credentials: input.credentials } : {}),
        ...(input.autoAccept !== undefined ? { auto_accept: input.autoAccept } : {}),
        ...(input.sendToKitchen !== undefined ? { send_to_kitchen: input.sendToKitchen } : {}),
        ...(input.settings ? { settings: input.settings } : {}),
      },
      { onConflict: "org_id,provider" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export interface ChannelSettingsPatch {
  is_active?: boolean;
  auto_accept?: boolean;
  prep_minutes?: number;
  commission_pct?: number;
  price_markup_pct?: number;
  send_to_kitchen?: boolean;
  external_store_id?: string;
  credentials?: Record<string, unknown>;
}

export async function updateChannel(
  orgId: string,
  id: string,
  patch: ChannelSettingsPatch,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dChannels.update(id, patch as Partial<Channel>);
    return;
  }
  const { error } = await getSupabase()
    .from("channels")
    .update(patch)
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}

export async function disconnectChannel(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dChannels.remove(id);
    return;
  }
  const { error } = await getSupabase().from("channels").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** The unified inbox. Newest first; `status` narrows to e.g. just pending. */
export async function listChannelOrders(
  orgId: string,
  limit = 100,
): Promise<ChannelOrder[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dChannelOrders
      .list({ org_id: orgId } as Partial<ChannelOrder>)
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .slice(0, limit);
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

export interface AcceptResult {
  order_id: string | null;
  order_number?: string;
  total?: number;
  already_decided: boolean;
}

/** Accept an inbound order — creates the real order and fires the ticket. */
export async function acceptChannelOrder(orgId: string, id: string): Promise<AcceptResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const co = dChannelOrders.get(id);
    if (!co) throw new Error("Order not found");
    if (co.status !== "pending") {
      return { order_id: co.order_id, already_decided: true };
    }
    const now = new Date().toISOString();
    const orderNumber = `ORD-${String(dOrders.list({ org_id: orgId }).length + 1).padStart(4, "0")}`;
    const gross = co.items.reduce((s, l) => s + l.price * l.qty, 0) || co.gross;
    const orderId = uid();
    demoTable<{ id: string } & Record<string, unknown>>("orders").insert({
      id: orderId, org_id: orgId, order_number: orderNumber, order_type: co.order_type,
      table_id: null, customer_id: null, guest_name: co.customer_name || null,
      items: co.items.map((l) => ({
        recipe_id: l.recipe_id, name: l.name, qty: l.qty, price: l.price,
      })),
      subtotal: +(gross * 0.915).toFixed(2), tax: +(gross * 0.085).toFixed(2),
      tip: 0, total: +gross.toFixed(2), discount: 0,
      status: "paid", kitchen_status: "new", kitchen_notes: co.notes,
      source: co.provider, created_at: now,
    });
    dChannelOrders.update(id, { status: "accepted", order_id: orderId, decided_at: now });
    return { order_id: orderId, order_number: orderNumber, total: gross, already_decided: false };
  }
  const { data, error } = await getSupabase().rpc("accept_channel_order", { _channel_order: id });
  if (error) throw error;
  return data as AcceptResult;
}

export async function rejectChannelOrder(
  orgId: string,
  id: string,
  reason: string,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dChannelOrders.update(id, {
      status: "rejected", reject_reason: reason, decided_at: new Date().toISOString(),
    });
    return;
  }
  const { error } = await getSupabase().rpc("reject_channel_order", {
    _channel_order: id,
    _reason: reason,
  });
  if (error) throw error;
}

export interface SumUpSyncResult {
  imported: number;
  /** Lines that matched no recipe — rang up, but moved no stock. */
  unmapped: number;
  failed: number;
  more: boolean;
}

/**
 * Pull new SumUp till sales into DishData now. Throws with the server's
 * message (bad API key, SumUp down, …) so the caller can show it.
 */
export async function syncSumUp(orgId: string): Promise<SumUpSyncResult> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return { imported: 0, unmapped: 0, failed: 0, more: false };
  }
  const { data: session } = await getSupabase().auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  const res = await fetch("/api/channels/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ org_id: orgId }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<SumUpSyncResult> & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `Sync failed (${res.status}).`);
  return {
    imported: body.imported ?? 0,
    unmapped: body.unmapped ?? 0,
    failed: body.failed ?? 0,
    more: !!body.more,
  };
}

/** The URL the platform should POST orders to. */
export function webhookUrl(provider: ChannelProvider, storeId: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const q = storeId ? `?store=${encodeURIComponent(storeId)}` : "";
  return `${base}/api/channels/${provider}${q}`;
}

/**
 * Tell the platform what staff decided, so the order does not also need
 * accepting on the platform's own tablet.
 *
 * Best-effort and deliberately non-throwing: our order already exists by the
 * time this runs, so a platform hiccup must not make the accept look failed.
 * Returns a message when the platform was not acknowledged, so the UI can warn
 * that the tablet still needs a tap.
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
    const res = await fetch("/api/channels/ack", {
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
