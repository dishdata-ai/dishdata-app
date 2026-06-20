"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/useAuth";
import { useOrg } from "@/lib/hooks/useOrg";

export function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand-400" />
    </div>
  );
}

/** Client auth gate. Middleware blocks unauthenticated requests; this covers the
 *  async client session load and pushes to /auth if it resolves to null. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/auth");
  }, [loading, user, router]);
  if (loading || !user) return <FullScreenSpinner />;
  return <>{children}</>;
}

/** Requires an active org; sends new users to onboarding. */
export function RequireOrg({ children }: { children: ReactNode }) {
  const { org, loading } = useOrg();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !org) router.replace("/onboarding");
  }, [loading, org, router]);
  if (loading || !org) return <FullScreenSpinner />;
  return <>{children}</>;
}

/** Per-module access gate. Wrap page elements: <RequireModule id="kitchen"><Kitchen/></RequireModule> */
export function RequireModule({ id, children }: { id: string; children: ReactNode }) {
  const { moduleIds, loading } = useOrg();
  if (loading) return <FullScreenSpinner />;
  if (!moduleIds.has(id)) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <p className="font-display text-2xl font-bold text-white">No access</p>
        <p className="max-w-sm text-sm text-zinc-400">
          Your account doesn't have access to this module. Ask an admin to enable it in Team &
          Access.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
