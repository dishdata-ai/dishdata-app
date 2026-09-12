"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Field } from "@/components/ui";
import { useAuth } from "@/lib/hooks/useAuth";
import { AuthShell } from "@/views/Auth";

export default function ResetPassword() {
  const { user, loading, updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The reset link's token arrives as a URL hash fragment, which Supabase's
  // client turns into a signed-in session asynchronously after this page
  // mounts — `loading` can already be false by then. Give that a beat before
  // concluding the link is dead, so a real recovery link doesn't flash
  // "expired" out from under someone who clicked it seconds ago.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (loading) return;
    if (user) {
      setSettled(true);
      return;
    }
    const hasRecoveryHash = window.location.hash.includes("type=recovery");
    if (!hasRecoveryHash) {
      setSettled(true);
      return;
    }
    const t = setTimeout(() => setSettled(true), 2000);
    return () => clearTimeout(t);
  }, [loading, user]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const err = await updatePassword(password);
      if (err) {
        setError(err);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (loading || !settled) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthShell>
        <h2 className="mb-2 font-display text-xl font-bold text-white">Link expired</h2>
        <p className="mb-5 text-sm text-zinc-400">
          This reset link is no longer valid — it may have already been used, or it's timed out.
          Request a fresh one from the sign-in page.
        </p>
        <Button className="w-full py-3" onClick={() => router.replace("/auth")}>
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell>
        <h2 className="mb-2 font-display text-xl font-bold text-white">Password updated</h2>
        <p className="mb-5 text-sm text-zinc-400">You're all set — continue into your workspace.</p>
        <Button className="w-full py-3" onClick={() => router.replace("/")}>
          Continue
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h2 className="mb-1 font-display text-xl font-bold text-white">Set a new password</h2>
      <p className="mb-5 text-sm text-zinc-400">Signed in as {user.email}.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            autoComplete="new-password"
            autoFocus
          />
        </Field>
        <Field label="Confirm password">
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            required
            minLength={6}
            autoComplete="new-password"
          />
        </Field>
        {error && (
          <p className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs leading-relaxed text-rose-soft">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full py-3">
          {busy ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </AuthShell>
  );
}
