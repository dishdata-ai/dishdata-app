import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, Button, Badge } from "@/components/ui";
import { useAuth } from "@/lib/hooks/useAuth";
import { toast } from "@/lib/toast";

interface StatusResponse {
  connected?: boolean;
  configured?: boolean;
  chargesEnabled?: boolean;
  detailsSubmitted?: boolean;
  error?: string;
}

export function PaymentsCard({ isAdmin }: { isAdmin: boolean }) {
  const { isDemo } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

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
      ) : status?.configured === false ? (
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
        </>
      )}
    </Card>
  );
}
