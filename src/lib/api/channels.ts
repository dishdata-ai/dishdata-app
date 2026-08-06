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
      auto_accept: false, prep_minutes: 20, commission_pct: 30,
      price_markup_pct: 0, send_to_kitchen: true, settings: {},
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

/** The URL the platform should POST orders to. */
export function webhookUrl(provider: ChannelProvider, storeId: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const q = storeId ? `?store=${encodeURIComponent(storeId)}` : "";
  return `${base}/api/channels/${provider}${q}`;
}
