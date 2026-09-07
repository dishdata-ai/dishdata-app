// Till sessions and cash movements — the drawer's cash book.
//
// Every write goes through an RPC rather than a table insert: opening,
// closing and recording a movement each carry invariants (only one open
// session per restaurant, no withdrawing more than the drawer holds, the
// expected-balance maths) that live in the database so they hold no matter
// which client is talking to it. See migration 0040_till_sessions.sql.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import type {
  TillSession, CashMovement, CashDirection, Payment, Order,
} from "@/lib/api/database.types";

const dSessions = demoTable<TillSession>("till_sessions");
const dMovements = demoTable<CashMovement>("cash_movements");
const dPayments = demoTable<Payment>("payments");
const dOrders = demoTable<Order>("orders");

/**
 * A refund is only a status change on the order — no negative payment row is
 * written — so a refunded order's cash payment has physically left the drawer
 * and must not be counted as still in it. Mirrors the same exclusion in
 * till_expected_cash().
 */
function cashCountsTowardDrawer(p: Payment): boolean {
  if (p.method !== "cash") return false;
  const order = dOrders.list().find((o) => o.id === p.order_id);
  return !order || (order.status !== "void" && order.status !== "refunded");
}

/**
 * The one place the expected drawer balance is defined for demo mode, mirroring
 * till_expected_cash() in SQL: float + cash taken during the session +/- manual
 * movements. Tips are included because they physically land in the drawer.
 */
function demoExpected(session: TillSession): number {
  const cashSales = dPayments
    .list({ org_id: session.org_id } as Partial<Payment>)
    .filter(
      (p) =>
        cashCountsTowardDrawer(p) &&
        p.created_at >= session.opened_at &&
        (!session.closed_at || p.created_at <= session.closed_at),
    )
    .reduce((s, p) => s + p.amount + p.tip_amount, 0);

  const moves = dMovements.list({ session_id: session.id } as Partial<CashMovement>);
  const cashIn = moves.filter((m) => m.direction === "in").reduce((s, m) => s + m.amount, 0);
  const cashOut = moves.filter((m) => m.direction === "out").reduce((s, m) => s + m.amount, 0);

  return session.opening_float + cashSales + cashIn - cashOut;
}

export async function getOpenTill(orgId: string): Promise<TillSession | null> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dSessions.list({ org_id: orgId, status: "open" } as Partial<TillSession>)[0] ?? null;
  }
  const { data, error } = await getSupabase()
    .from("till_sessions")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "open")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listTillSessions(orgId: string, limit = 60): Promise<TillSession[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dSessions
      .list({ org_id: orgId } as Partial<TillSession>)
      .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
      .slice(0, limit);
  }
  const { data, error } = await getSupabase()
    .from("till_sessions")
    .select("*")
    .eq("org_id", orgId)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listCashMovements(sessionId: string): Promise<CashMovement[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dMovements
      .list({ session_id: sessionId } as Partial<CashMovement>)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  const { data, error } = await getSupabase()
    .from("cash_movements")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

/** Live expected balance for an open session — what the books say is in the drawer. */
export async function expectedCash(session: TillSession): Promise<number> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return demoExpected(session);
  }
  const { data, error } = await getSupabase().rpc("till_expected_cash", { _session: session.id });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function openTill(orgId: string, openingFloat: number): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    if (dSessions.list({ org_id: orgId, status: "open" } as Partial<TillSession>).length) {
      throw new Error("A till is already open.");
    }
    const id = uid();
    dSessions.insert({
      id, org_id: orgId, status: "open", opening_float: openingFloat,
      opened_at: new Date().toISOString(), opened_by: null,
      closed_at: null, closed_by: null,
      expected_closing: null, counted_closing: null, difference: null, note: null,
      created_at: new Date().toISOString(),
    });
    return id;
  }
  const { data, error } = await getSupabase().rpc("open_till", {
    _org: orgId,
    _opening_float: openingFloat,
  });
  if (error) throw error;
  return data as string;
}

export async function recordCashMovement(
  orgId: string,
  direction: CashDirection,
  amount: number,
  reason: string,
  comment?: string | null,
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const session = dSessions.list({ org_id: orgId, status: "open" } as Partial<TillSession>)[0];
    if (!session) throw new Error("No till is currently open.");
    if (direction === "out" && amount > demoExpected(session)) {
      throw new Error("Cannot take out more than the drawer holds.");
    }
    dMovements.insert({
      id: uid(), org_id: orgId, session_id: session.id, direction, amount,
      reason, comment: comment ?? null,
      created_at: new Date().toISOString(), created_by: null,
    });
    return;
  }
  const { error } = await getSupabase().rpc("record_cash_movement", {
    _org: orgId,
    _direction: direction,
    _amount: amount,
    _reason: reason,
    _comment: comment ?? null,
  });
  if (error) throw error;
}

export async function closeTill(orgId: string, counted: number, note?: string | null): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const session = dSessions.list({ org_id: orgId, status: "open" } as Partial<TillSession>)[0];
    if (!session) throw new Error("No till is currently open.");
    const expected = demoExpected(session);
    dSessions.update(session.id, {
      status: "closed",
      closed_at: new Date().toISOString(),
      expected_closing: expected,
      counted_closing: counted,
      difference: counted - expected,
      note: note ?? null,
    });
    return;
  }
  const { error } = await getSupabase().rpc("close_till", {
    _org: orgId,
    _counted: counted,
    _note: note ?? null,
  });
  if (error) throw error;
}

/**
 * Cash taken while no till was open, since the last session closed.
 *
 * Deliberately surfaced rather than absorbed: those sales belong to no
 * session, so they appear in no cash book and no drawer count. Under §146 AO
 * that is a real gap, and the person who can still remember what happened is
 * the one looking at this screen today.
 */
export async function unassignedCashSince(orgId: string, since: string | null): Promise<number> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    return dPayments
      .list({ org_id: orgId } as Partial<Payment>)
      .filter((p) => cashCountsTowardDrawer(p) && (!since || p.created_at > since))
      .reduce((s, p) => s + p.amount + p.tip_amount, 0);
  }
  // Same void/refunded exclusion as till_expected_cash — warning about money
  // that was handed back would send staff hunting for cash that isn't missing.
  let q = getSupabase()
    .from("payments")
    .select("amount, tip_amount, orders!inner(status)")
    .eq("org_id", orgId)
    .eq("method", "cash")
    .not("orders.status", "in", "(void,refunded)");
  if (since) q = q.gt("created_at", since);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).reduce((s, p) => s + Number(p.amount) + Number(p.tip_amount), 0);
}
