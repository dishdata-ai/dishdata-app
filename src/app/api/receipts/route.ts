import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateReceiptHTML } from "@/lib/receipts";
import type { Order, Org, Payment } from "@/lib/api/database.types";

export const runtime = "nodejs";

/**
 * POST /api/receipts
 * Body: { order_id: string, email?: string, send?: boolean }
 *
 * Generates (or re-fetches) the receipt for a PAID order and returns its
 * print-ready HTML. When `send` is true and an email is available, also emails
 * it to the customer via Resend and marks the receipt as emailed.
 *
 * Authorization: the caller's Supabase session (must be a member of the org).
 * The generate_receipt RPC re-checks membership and creates the receipt
 * atomically with a gapless sequential number.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Receipts require a connected backend." }, { status: 400 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let body: { order_id?: string; email?: string; send?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.order_id) {
    return NextResponse.json({ error: "order_id is required." }, { status: 400 });
  }

  // Atomically get-or-create the receipt (member-gated, gapless numbering).
  const { data: receiptJson, error: rpcErr } = await supabase.rpc("generate_receipt", {
    _order_id: body.order_id,
    _email: body.email ?? null,
  });
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }
  const receipt = receiptJson as {
    id: string;
    receipt_number: string;
    customer_email: string | null;
    customer_name: string | null;
  };

  // Fetch the data the receipt renders from (RLS lets org members read these).
  const { data: order } = await supabase.from("orders").select("*").eq("id", body.order_id).single();
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const { data: org } = await supabase.from("orgs").select("*").eq("id", order.org_id).single();
  if (!org) return NextResponse.json({ error: "Organization not found." }, { status: 404 });

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("order_id", body.order_id);

  const html = generateReceiptHTML({
    receiptNumber: receipt.receipt_number,
    order: order as Order,
    org: org as Org,
    payments: (payments as Payment[]) ?? [],
    customerName: receipt.customer_name,
    customerEmail: body.send ? (body.email ?? receipt.customer_email) : null,
  });

  // Optional: email the receipt to the customer via Resend.
  let emailed = false;
  let emailError: string | undefined;
  const emailTo = body.email ?? receipt.customer_email;
  if (body.send && emailTo) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      emailError = "Email is not configured (RESEND_API_KEY missing).";
    } else {
      const from = process.env.RESEND_FROM || `${org.name} <belege@dishdata.de>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [emailTo],
          subject: `Ihr Beleg ${receipt.receipt_number} — ${org.name}`,
          html,
        }),
      });
      if (res.ok) {
        emailed = true;
        await supabase
          .from("receipts")
          .update({ status: "emailed", emailed_at: new Date().toISOString(), customer_email: emailTo })
          .eq("id", receipt.id);
      } else {
        const detail = await res.text();
        emailError = `Email failed: ${detail.slice(0, 200)}`;
      }
    }
  }

  return NextResponse.json({
    receiptNumber: receipt.receipt_number,
    html,
    emailed,
    ...(emailError ? { emailError } : {}),
  });
}
