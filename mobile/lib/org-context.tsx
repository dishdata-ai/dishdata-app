import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getOrgContext, type OrgContext } from "@/lib/api/session";
import { isSupabaseConfigured, getSupabase, bindAuthAutoRefresh } from "@/lib/supabase";

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
    const next = await getOrgContext();
    setCtx(next);
    setLoading(false);
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
