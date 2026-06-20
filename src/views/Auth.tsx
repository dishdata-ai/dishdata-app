"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDot, Sparkles, ShieldCheck, Zap, TicketCheck } from "lucide-react";
import { Button, Input, Field, Badge } from "@/components/ui";
import { useAuth } from "@/lib/hooks/useAuth";
import { acceptInvite } from "@/lib/api/orgs";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export default function Auth() {
  const { signIn, signUp, isDemo, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params?.get("invite") ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteCode, setInviteCode] = useState(params?.get("invite") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redeemInvite = async () => {
    if (!inviteCode.trim()) return;
    try {
      await acceptInvite(inviteCode.trim());
      toast.success("Invite accepted", "You've joined the team");
    } catch (e) {
      toast.error("Invite problem", e instanceof Error ? e.message : "Could not redeem invite");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const err =
        mode === "signin"
          ? await signIn(email.trim(), password)
          : await signUp(email.trim(), password, fullName.trim());
      if (err) {
        setError(err);
        return;
      }
      await redeemInvite();
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  // Demo mode: no real auth — offer direct entry
  if (isDemo && user) {
    return (
      <AuthShell>
        <div className="space-y-5 text-center">
          <Badge tone="amber" className="mx-auto">Demo mode — no backend configured</Badge>
          <h2 className="font-display text-2xl font-bold text-white">Try DishData instantly</h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            Supabase credentials aren't set, so DishData runs fully in your browser with sample
            data. Add <code className="rounded bg-white/10 px-1 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-white/10 px-1 text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to{" "}
            <code className="rounded bg-white/10 px-1 text-xs">.env.local</code> for real accounts.
          </p>
          <Button className="w-full py-3" onClick={() => router.replace("/")}>
            Enter Demo Workspace
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="mb-6 flex rounded-xl border border-line bg-white/[0.03] p-1">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "flex-1 cursor-pointer rounded-lg py-2 text-sm font-semibold transition-all",
              mode === m
                ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                : "text-zinc-400 hover:text-white",
            )}
          >
            {m === "signin" ? "Sign In" : "Create Account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" && (
          <Field label="Your name">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Alex Chen" required />
          </Field>
        )}
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@restaurant.com" required autoComplete="email" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </Field>
        <Field label="Invite code (optional)">
          <div className="relative">
            <TicketCheck className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="Joining a team? Paste code" className="pl-9" />
          </div>
        </Field>

        {error && (
          <p className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs leading-relaxed text-rose-soft">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="w-full py-3">
          {busy ? "One moment…" : mode === "signin" ? "Sign In" : "Create Account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-zinc-500">
        {mode === "signup"
          ? "You'll set up your restaurant right after."
          : "New here? Create an account to start your restaurant workspace."}
      </p>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 420px at 20% 15%, rgba(16,185,129,0.14), transparent 60%), radial-gradient(600px 380px at 80% 85%, rgba(34,211,238,0.10), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-400 shadow-lg shadow-brand-500/25">
            <CircleDot className="h-5 w-5 text-zinc-950" strokeWidth={2.5} />
          </div>
          <span className="font-display text-xl font-bold text-white">
            Dish<span className="text-gradient">Data</span>
          </span>
        </div>
        <div className="relative max-w-md space-y-6">
          <h1 className="font-display text-4xl leading-tight font-bold text-white">
            Run your restaurant on <span className="text-gradient">data</span>, not gut feel.
          </h1>
          {[
            [Sparkles, "AI insights computed from your live sales, stock and margins"],
            [Zap, "POS, kitchen, inventory and team — one connected system"],
            [ShieldCheck, "Your own workspace with per-user module access control"],
          ].map(([Icon, text]) => {
            const I = Icon as typeof Sparkles;
            return (
              <div key={text as string} className="flex items-start gap-3">
                <div className="rounded-lg bg-white/5 p-2">
                  <I className="h-4 w-4 text-brand-300" />
                </div>
                <p className="pt-1.5 text-sm text-zinc-400">{text as string}</p>
              </div>
            );
          })}
        </div>
        <p className="relative text-xs text-zinc-600">© 2026 DishData · Restaurant Intelligence</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="glass w-full max-w-md rounded-2xl p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-400">
              <CircleDot className="h-5 w-5 text-zinc-950" strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg font-bold text-white">
              Dish<span className="text-gradient">Data</span>
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
