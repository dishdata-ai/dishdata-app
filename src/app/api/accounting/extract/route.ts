import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { extractInvoice, EXTRACTION_MODEL } from "@/lib/accounting/extract";
import { evaluateCompliance, type ExtractedInvoice } from "@/lib/accounting/types";

export const runtime = "nodejs";
export const maxDuration = 120; // Opus with thinking on a multi-page PDF takes time

/**
 * POST /api/accounting/extract
 * Body: { documentId: string, fiscalYear?: number }
 * Downloads the stored Beleg (RLS-scoped to the caller's org), runs Claude
 * extraction + the compliance engine, and inserts the acct_invoices row.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { documentId, fiscalYear } = (await request.json()) as {
    documentId?: string;
    fiscalYear?: number;
  };
  if (!documentId) return NextResponse.json({ error: "documentId required." }, { status: 400 });

  // RLS guarantees the caller is a member of the document's org.
  const { data: doc, error: docErr } = await supabase
    .from("acct_documents")
    .select("id, org_id, storage_path, mime_type, original_filename")
    .eq("id", documentId)
    .single();
  if (docErr || !doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const { data: org } = await supabase
    .from("orgs")
    .select("name")
    .eq("id", doc.org_id)
    .single();

  const { data: file, error: dlErr } = await supabase.storage
    .from("belege")
    .download(doc.storage_path);
  if (dlErr || !file) {
    return NextResponse.json({ error: `Could not read stored Beleg: ${dlErr?.message}` }, { status: 500 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  let extracted: ExtractedInvoice;
  try {
    extracted = await extractInvoice({
      bytes,
      mimeType: doc.mime_type,
      orgName: org?.name ?? "",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Extraction failed." },
      { status: 502 },
    );
  }

  const { flags, bucket } = evaluateCompliance(extracted, { fiscalYear });

  // Duplicate detection: same vendor + invoice number already recorded.
  if (extracted.invoice_no) {
    const { data: dup } = await supabase
      .from("acct_invoices")
      .select("id")
      .eq("org_id", doc.org_id)
      .eq("vendor_name", extracted.vendor_name)
      .eq("invoice_no", extracted.invoice_no)
      .neq("status", "excluded")
      .maybeSingle();
    if (dup) {
      flags.push({
        code: "possible_duplicate",
        severity: "warn",
        message: `Same vendor + invoice no. already recorded (${dup.id}). Confirm it is not counted twice.`,
      });
    }
  }

  const { data: invoice, error: insErr } = await supabase
    .from("acct_invoices")
    .insert({
      org_id: doc.org_id,
      document_id: doc.id,
      direction: extracted.direction,
      vendor_name: extracted.vendor_name,
      vendor_vat_id: extracted.vendor_vat_id,
      invoice_no: extracted.invoice_no,
      invoice_date: extracted.invoice_date,
      service_date: extracted.service_date,
      currency: extracted.currency || "EUR",
      vat_lines: extracted.vat_lines,
      total_net: extracted.total_net,
      total_vat: extracted.total_vat,
      gross: extracted.gross,
      recipient_status: extracted.recipient_status,
      recipient_name: extracted.recipient_name,
      delivery_address: extracted.delivery_address,
      payment_method: extracted.payment_method,
      seller_kleinunternehmer: extracted.seller_kleinunternehmer,
      eu_zero_rated: extracted.eu_zero_rated,
      reverse_charge_domestic: extracted.reverse_charge_domestic,
      is_bewirtung: extracted.is_bewirtung,
      asset_like: extracted.asset_like,
      category: extracted.category || "Other",
      compliance_flags: flags,
      bucket: flags.some((f) => f.code === "possible_duplicate") && bucket === "valid" ? "review" : bucket,
      status: "needs_review",
      notes: extracted.notes || null,
      extraction_model: EXTRACTION_MODEL,
    })
    .select()
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  return NextResponse.json({ invoice });
}
