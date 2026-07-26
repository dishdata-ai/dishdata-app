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

export function OrgProvider({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      // null = genuine logged-out state (clears ctx → sign-in). A transient
      // network/DB error throws instead (caught below), so a hiccup on reopen
      // never blanks an already-signed-in session.
      const next = await getOrgContext();
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
