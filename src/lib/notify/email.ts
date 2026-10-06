import "server-only";

// Transactional email through Resend's HTTP API (no SDK needed).
//   RESEND_API_KEY   the API key
//   EMAIL_FROM       e.g. "kokoland <orders@kokolandberlin.com>" (the domain must be verified in Resend)
//   EMAIL_REPLY_TO   optional, where guest replies go
// Without a key, emails are skipped (logged) so nothing breaks in development.

export interface EmailMessage {
  to: string;
  /** Restaurant's own sender once its domain is verified; defaults to EMAIL_FROM. */
  from?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.warn("[notify] email skipped: set RESEND_API_KEY and EMAIL_FROM");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: msg.from || process.env.EMAIL_FROM,
        to: [msg.to],
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
