import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { Card, Button, Badge, Field, Input } from "@/components/ui";
import { useAuth } from "@/lib/hooks/useAuth";
import { toast } from "@/lib/toast";

interface StatusResponse {
  connected?: boolean;
  configured?: boolean;
  chargesEnabled?: boolean;
  detailsSubmitted?: boolean;
  mode?: "connect" | "direct";
  accountId?: string;
  hasWebhookSecret?: boolean;
  webhookUrl?: string;
  error?: string;
}

export function PaymentsCard({ isAdmin }: { isAdmin: boolean }) {
  const { isDemo } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [savingKeys, setSavingKeys] = useState(false);
  const [showDirect, setShowDirect] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/status");
      setStatus(await res.json());
    } catch {
      setStatus({ error: "Could not reach the payments service." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isDemo) loadStatus();
    else setLoading(false);
  }, [isDemo, loadStatus]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/payments/connect", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start onboarding.");
      window.location.href = data.url; // Stripe-hosted onboarding
    } catch (e) {
      toast.error("Could not connect Stripe", e instanceof Error ? e.message : "");
      setConnecting(false);
    }
  };

  const saveKeys = async () => {
    setSavingKeys(true);
    try {
      const res = await fetch("/api/payments/direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey: secretKey || undefined, webhookSecret: webhookSecret || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      setSecretKey("");
      setWebhookSecret("");
      toast.success("Saved");
      await loadStatus();
    } catch (e) {
      toast.error("Could not save keys", e instanceof Error ? e.message : "");
    } finally {
      setSavingKeys(false);
    }
  };

  const removeKeys = async () => {
    if (!confirm("Remove your Stripe keys and switch online payments off?")) return;
    const res = await fetch("/api/payments/direct", { method: "DELETE" });
    if (res.ok) {
      toast.success("Payments switched off");
      loadStatus();
    }
  };

  const direct = status?.mode === "direct";
  const active = status?.connected && status?.chargesEnabled;
  const incomplete = status?.connected && !status?.chargesEnabled;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-accent-400" />
        <h3 className="font-semibold text-white">Payments</h3>
        {active && (
          <Badge tone="green">
            <CheckCircle2 className="h-3 w-3" /> Active
          </Badge>
        )}
        {incomplete && (
          <Badge tone="amber">
            <AlertTriangle className="h-3 w-3" /> Onboarding incomplete
          </Badge>
        )}
      </div>

      {isDemo ? (
        <p className="text-xs text-zinc-500">
          Connect a Supabase backend and add Stripe test keys to accept online card payments.
        </p>
      ) : loading ? (
        <p className="text-xs text-zinc-500">Checking connection…</p>
      ) : status?.configured === false && !direct && !isAdmin ? (
        <p className="text-xs text-zinc-500">
          Stripe isn&apos;t configured on the server yet. Add <code>STRIPE_SECRET_KEY</code> (test mode) to{" "}
          <code>.env.local</code> to enable payments.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            {active
              ? "Your Stripe account is connected. Online orders are charged to your account; payouts go to your bank."
              : incomplete
                ? "Onboarding was started but isn't finished. Resume to enable charges."
                : "Connect your own Stripe account to accept card payments. Money settles to your bank — set your Vivid IBAN as the payout account if you like."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && !active && (
              <Button onClick={connect} disabled={connecting}>
                <ExternalLink className="h-4 w-4" />
                {connecting ? "Redirecting…" : incomplete ? "Resume onboarding" : "Connect Stripe"}
              </Button>
            )}
            <Button variant="ghost" onClick={loadStatus} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
          {!isAdmin && !active && (
            <p className="mt-3 text-xs text-zinc-500">Ask an owner or admin to connect payments.</p>
          )}

          {isAdmin && (
            <div className="mt-5 border-t border-line pt-4">
              <button type="button" onClick={() => setShowDirect((v) => !v)} className="cursor-pointer text-sm font-medium text-accent-400 hover:underline">
                {direct ? "Your own Stripe account (keys)" : "Use your own Stripe account instead (for a registered company)"}
              </button>
              {(showDirect || direct) && (
                <div className="mt-3 space-y-3">
                  <p className="text-xs text-zinc-500">
                    Money goes straight to your Stripe account, with no platform fee. In Stripe → Developers → API keys copy the <b>secret key</b> (<code>sk_test_…</code> while testing). Keys are stored on the server and never shown again.
                  </p>
                  <Field label={status?.connected && direct ? "Replace secret key" : "Stripe secret key"}>
                    <Input type="password" autoComplete="off" placeholder="sk_test_…" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
                  </Field>
                  {direct && status?.webhookUrl && (
                    <div className="rounded-xl border border-line p-3 text-xs text-zinc-400">
                      <p className="mb-1">In Stripe → Developers → Webhooks → Add endpoint, use this address and the event <code>checkout.session.completed</code>:</p>
                      <p className="flex items-center gap-2 font-mono break-all text-white">
                        {status.webhookUrl}
                        <button type="button" aria-label="Copy" className="cursor-pointer" onClick={() => navigator.clipboard.writeText(status.webhookUrl!)}><Copy className="h-3 w-3" /></button>
                      </p>
                    </div>
                  )}
                  {direct && (
                    <Field label={status?.hasWebhookSecret ? "Replace webhook signing secret" : "Webhook signing secret"}>
                      <Input type="password" autoComplete="off" placeholder="whsec_…" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
                    </Field>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={saveKeys} disabled={savingKeys || (!secretKey && !webhookSecret)}>{savingKeys ? "Saving…" : "Save"}</Button>
                    {direct && <Button variant="ghost" onClick={removeKeys}>Remove keys</Button>}
                    {direct && status?.connected && !status?.hasWebhookSecret && <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> Webhook secret missing: payments will not mark orders paid</Badge>}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
