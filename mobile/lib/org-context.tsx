import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getOrgContext, type OrgContext } from "@/lib/api/session";
import { isSupabaseConfigured, getSupabase, bindAuthAutoRefresh } from "@/lib/supabase";
import { setActiveCurrency } from "@/lib/format";

interface OrgState {
  ctx: OrgContext | null;
  loading: boolean;
  isDemo: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<OrgState | null>(null);

/** Reject after `ms` so an awaited call can never hang the UI indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      // Hard timeout so a stalled network call (e.g. a hung token refresh on
      // flaky Wi-Fi) can never leave the app on an endless spinner. getSession()
      // is a local read and normally resolves instantly; 12s is only a backstop.
      const next = await withTimeout(getOrgContext(), 12_000);
      // null = genuine logged-out state (clears ctx → sign-in). A transient
      // network/DB error or timeout throws instead (caught below), so a hiccup
      // on reopen never blanks an already-signed-in session.
      setCtx(next);
      if (next) setActiveCurrency(next.org.currency);
    } catch {
      // Keep whatever context we already had rather than wedging the app.
    } finally {
      setLoading(false); // never leave the app stuck on the loading screen
    }
  };

  useEffect(() => {
    bindAuthAutoRefresh();
    refresh();
    if (isSupabaseConfigured) {
      const { data } = getSupabase().auth.onAuthStateChange(() => refresh());
      return () => data.subscription.unsubscribe();
    }
  }, []);

  return (
    <Ctx.Provider value={{ ctx, loading, isDemo: !isSupabaseConfigured, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useOrg(): OrgState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrg must be used within OrgProvider");
  return v;
}
