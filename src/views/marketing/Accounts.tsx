"use client";

import { useState } from "react";
import { AlertTriangle, Pause, Play, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, PageSkeleton } from "@/components/ui";
import { useInvalidate, useSocialAccounts } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { isSupabaseConfigured } from "@/lib/supabase";
import { connectDemoAccount, disconnectSocialAccount, setSocialAccountActive } from "@/lib/api/socialAccounts";
import { SOCIAL_PROVIDERS, type SocialGroup, type SocialProviderDef } from "@/lib/social/providers";
import { toast } from "@/lib/toast";
import { errorMessage, timeAgo } from "@/lib/utils";
import type { SocialAccount } from "@/lib/api/database.types";

const GROUPS: SocialGroup[] = ["Google", "Meta", "TikTok"];

export default function Accounts() {
  const { org, isAdmin } = useOrg();
  const accountsQ = useSocialAccounts();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);

  if (accountsQ.isLoading || !org) return <PageSkeleton />;
  const accounts = accountsQ.data ?? [];

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      invalidate("social_accounts");
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error("That did not work", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = (p: SocialProviderDef) => {
    if (!isSupabaseConfigured) {
      return run(`connect:${p.id}`, () => connectDemoAccount(org.id, p.id), `${p.label} connected (demo)`);
    }
    // Real orgs: the provider's OAuth route redirects to the platform and back.
    window.location.href = `/api/social/${p.id}/connect?org=${encodeURIComponent(org.id)}`;
  };

  const disconnect = (a: SocialAccount) => {
    if (!window.confirm(`Disconnect ${a.display_name || a.provider}? Scheduled posts to it will not be published.`)) return;
    return run(`del:${a.id}`, () => disconnectSocialAccount(org.id, a.id), "Disconnected");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-xl border border-line bg-white/[0.02] p-3 text-xs text-zinc-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
        <p>
          Connecting lets DishData post and read replies on your behalf. Access tokens are stored encrypted on the
          server and are never sent to the browser. Nothing is published or sent without a person confirming it.
          {!isAdmin && " Only owners and admins can connect or disconnect accounts."}
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold text-white">{group}</h2>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {SOCIAL_PROVIDERS.filter((p) => p.group === group).map((p) => {
              const mine = accounts.filter((a) => a.provider === p.id);
              const available = p.implemented || !isSupabaseConfigured;
              return (
                <Card key={p.id} className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.tone }} />
                      <h3 className="font-semibold text-white">{p.label}</h3>
                    </div>
                    {mine.length > 0 ? (
                      <Badge tone="green">{mine.length === 1 ? "Connected" : `${mine.length} connected`}</Badge>
                    ) : available ? (
                      <Badge tone="neutral">Not connected</Badge>
                    ) : (
                      <Badge tone="violet">Coming soon</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{p.blurb}</p>

                  {mine.map((a) => (
                    <div key={a.id} className="mt-3 rounded-lg border border-line bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{a.display_name || a.external_id}</p>
                          <p className="truncate text-[11px] text-zinc-500">
                            {a.handle ? `${a.handle} · ` : ""}
                            {a.last_synced_at ? `Synced ${timeAgo(a.last_synced_at)}` : "Not synced yet"}
                          </p>
                        </div>
                        {a.needs_reauth ? (
                          <Badge tone="rose">Reconnect</Badge>
                        ) : (
                          <Badge tone={a.is_active ? "green" : "amber"}>{a.is_active ? "Active" : "Paused"}</Badge>
                        )}
                      </div>
                      {a.last_error && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-soft/10 p-2 text-[11px] text-rose-soft">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          {a.last_error}
                        </p>
                      )}
                      {isAdmin && (
                        <div className="mt-2 flex gap-2">
                          {a.needs_reauth && p.implemented && (
                            <Button className="py-1.5 text-xs" onClick={() => connect(p)}>
                              <Plug className="h-3.5 w-3.5" /> Reconnect
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            className="py-1.5 text-xs"
                            disabled={busy === `active:${a.id}`}
                            onClick={() =>
                              run(`active:${a.id}`, () => setSocialAccountActive(org.id, a.id, !a.is_active))
                            }
                          >
                            {a.is_active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                            {a.is_active ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            variant="danger"
                            className="ml-auto py-1.5 text-xs"
                            disabled={busy === `del:${a.id}`}
                            onClick={() => disconnect(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Disconnect
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}

                  {isAdmin && mine.length === 0 && (
                    <Button
                      className="mt-3 w-full"
                      disabled={!available || busy === `connect:${p.id}`}
                      onClick={() => connect(p)}
                    >
                      <Plug className="h-4 w-4" />
                      {available ? (isSupabaseConfigured ? "Connect" : "Connect (demo)") : "Not available yet"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
