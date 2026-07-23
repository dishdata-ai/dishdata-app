// Client API for the accounting module (Belege vault + extracted invoices).
// Upload flow: file → sha256 → `belege` bucket (write-once) → acct_documents row
// → POST /api/accounting/extract (Claude + compliance engine) → acct_invoices row.

import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { AcctDocument, AcctInvoice, InvoiceStatus } from "@/lib/accounting/types";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function extOf(name: string, mime: string): string {
  const fromName = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (fromName) return fromName;
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return mime.slice(6);
  return "bin";
}

/** Upload a Beleg (original preserved, GoBD) and run extraction. Returns the invoice row. */
export async function uploadBeleg(
  orgId: string,
  file: File,
  opts: { fiscalYear?: number } = {},
): Promise<AcctInvoice> {
  if (!isSupabaseConfigured) {
    throw new Error("Beleg upload requires a configured Supabase backend.");
  }
  const sb = getSupabase();
  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const year = new Date().getFullYear();
  const path = `${orgId}/${year}/${crypto.randomUUID()}.${extOf(file.name, file.type)}`;

  const { error: upErr } = await sb.storage.from("belege").upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false, // originals are immutable
  });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  // §147 AO: keep until 10 years after the end of the current year.
  const retention = `${year + 11}-01-01`;
  const { data: doc, error: docErr } = await sb
    .from("acct_documents")
    .insert({
      org_id: orgId,
      storage_path: path,
      original_filename: file.name,
      mime_type: file.type || "application/pdf",
      size_bytes: file.size,
      sha256: hash,
      source: file.type.startsWith("image/") ? "photo" : "upload",
      retention_until: retention,
    })
    .select()
    .single();
  if (docErr) throw docErr;

  const res = await fetch("/api/accounting/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ documentId: doc.id, fiscalYear: opts.fiscalYear }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Extraction failed.");
  return body.invoice as AcctInvoice;
}

export async function listAcctInvoices(orgId: string): Promise<AcctInvoice[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("acct_invoices")
    .select("*, document:acct_documents(storage_path, original_filename)")
    .eq("org_id", orgId)
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as AcctInvoice[];
}

export async function listAcctDocuments(orgId: string): Promise<AcctDocument[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await getSupabase()
    .from("acct_documents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AcctDocument[];
}

/** Confirm or exclude an invoice after human review. */
export async function setInvoiceStatus(
  orgId: string,
  invoiceId: string,
  status: InvoiceStatus,
): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { error } = await getSupabase()
    .from("acct_invoices")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("org_id", orgId);
  if (error) throw error;
}

/** Signed URL for viewing the original Beleg (1 hour). */
export async function belegUrl(storagePath: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await getSupabase().storage.from("belege").createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}
