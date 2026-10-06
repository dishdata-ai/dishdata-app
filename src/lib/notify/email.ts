import "server-only";

// Transactional email through Resend's HTTP API (no SDK needed).
//   RESEND_API_KEY   the API key
//   EMAIL_FROM       optional platform sender; falls back to RESEND_FROM (already used for receipts)
//                    and then to orders@dishdata.de, a domain already verified in Resend.
//                    A restaurant sends from its own address once it verifies its domain (Settings → Website & brand).
//   EMAIL_REPLY_TO   optional, where guest replies go
// Without a key, emails are skipped (logged) so nothing breaks in development.

export interface EmailMessage {
  /** One address, or several (comma-separated settings are split by the caller). */
  to: string | string[];
  /** Restaurant's own sender once its domain is verified; defaults to EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn("[notify] email skipped: set RESEND_API_KEY");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: msg.from || process.env.EMAIL_FROM || process.env.RESEND_FROM || "DishData <orders@dishdata.de>",
        to: Array.isArray(msg.to) ? msg.to : [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...((msg.replyTo || process.env.EMAIL_REPLY_TO) ? { reply_to: msg.replyTo || process.env.EMAIL_REPLY_TO } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[notify] email failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notify] email error", e instanceof Error ? e.message : e);
    return false;
  }
}
