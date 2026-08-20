"use client";

import { useState } from "react";
import { Receipt as ReceiptIcon, Printer, Mail, Loader2 } from "lucide-react";
import { Button, Modal, Field, Input } from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { isSupabaseConfigured } from "@/lib/supabase";
import { generateReceiptHTML } from "@/lib/receipts";
import type { Order } from "@/lib/api/database.types";

/**
 * "Beleg" action for a PAID order: preview the German receipt, print/save as PDF,
 * and email it to the customer. Talks to /api/receipts (which does the atomic
 * gapless numbering + Resend send). Falls back to a local preview in demo mode.
 */
export function ReceiptButton({ order }: { order: Order }) {
  const { org } = useOrg();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState<string>("");
  const [receiptNumber, setReceiptNumber] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string>("");

  const canEmail = isSupabaseConfigured;

  async function openReceipt() {
    setOpen(true);
    setNote("");
    if (html) return; // already loaded

    // Demo mode: render a local preview (no backend, no real receipt number).
    if (!isSupabaseConfigured) {
      if (!org) return;
      setReceiptNumber("RE-DEMO");
      setHtml(
        generateReceiptHTML({
          receiptNumber: "RE-DEMO",
          order,
          org,
          payments: [],
        }),
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error || "Could not generate the receipt.");
      } else {
        setHtml(data.html);
        setReceiptNumber(data.receiptNumber);
      }
    } catch {
      setNote("Network error generating the receipt.");
    } finally {
      setLoading(false);
    }
  }

  function print() {
    if (!html) return;
    const w = window.open("", "_blank", "width=440,height=820");
    if (!w) {
      setNote("Pop-up blocked — allow pop-ups to print.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 350);
  }

  async function sendEmail() {
    if (!email.trim()) {
      setNote("Enter an email address.");
      return;
    }
    setSending(true);
    setNote("");
    try {
      const res = await fetch("/api/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id, email: email.trim(), send: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error || "Could not send the receipt.");
      } else if (data.emailed) {
        setNote(`✓ Sent to ${email.trim()}`);
      } else {
        setNote(data.emailError || "Email is not configured on the server yet.");
      }
    } catch {
      setNote("Network error sending the receipt.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button variant="ghost" className="px-2.5 py-1.5 text-xs" onClick={openReceipt}>
        <ReceiptIcon className="h-3.5 w-3.5" />
        Beleg
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Beleg ${receiptNumber || ""}`.trim()} wide>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Beleg wird erstellt…
          </div>
        ) : html ? (
          <div className="space-y-4">
            {/*
              The receipt is a 76mm strip. Left full-width it sits marooned in a
              wide white field and reads as "nothing generated", so the frame is
              constrained to roughly paper width and centred — it looks like a
              receipt, and the top of it is visible without scrolling.
            */}
            <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-line bg-white">
              <iframe title="Beleg" srcDoc={html} className="h-[58vh] w-full" />
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <Button variant="ghost" onClick={print}>
                <Printer className="h-4 w-4" />
                Drucken / PDF
              </Button>

              <div className="flex-1 min-w-[220px]">
                <Field label="An Kunde senden (E-Mail)">
                  <Input
                    type="email"
                    placeholder="gast@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!canEmail}
                  />
                </Field>
              </div>
              <Button onClick={sendEmail} disabled={!canEmail || sending}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Senden
              </Button>
            </div>

            {!canEmail && (
              <p className="text-xs text-amber-400/80">
                Vorschau im Demo-Modus. E-Mail-Versand benötigt ein verbundenes Backend.
              </p>
            )}
            {note && <p className="text-xs text-zinc-300">{note}</p>}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-zinc-400">{note || "—"}</p>
        )}
      </Modal>
    </>
  );
}
