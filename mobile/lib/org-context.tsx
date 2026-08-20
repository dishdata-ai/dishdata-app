import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrgContext, type OrgContext } from "@/lib/api/session";
import { isSupabaseConfigured, getSupabase, bindAuthAutoRefresh } from "@/lib/supabase";
import { setActiveCurrency } from "@/lib/format";

/**
 * Last good org context, kept so a cold start on bad Wi-Fi opens the app
 * instead of bouncing to sign-in. The Supabase session itself already survives
 * in AsyncStorage; this is the profile/org/employee lookup around it, which is
 * network and can fail independently.
 */
const CACHE_KEY = "dishdata.orgctx.v1";

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
      if (next) {
        setActiveCurrency(next.org.currency);
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next)).catch(() => {});
      } else {
        AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
      }
    } catch {
      // Network/DB hiccup, not a logout. If we're already showing a context,
      // keep it. On a cold start there's nothing to keep, and falling through
      // would drop a signed-in user on the sign-in screen — so restore the last
      // known good context instead and let the queries retry behind it.
      setCtx((prev) => {
        if (prev) return prev;
        AsyncStorage.getItem(CACHE_KEY)
          .then((raw) => {
            if (!raw) return;
            const cached = JSON.parse(raw) as OrgContext;
            setCtx((current) => current ?? cached);
            setActiveCurrency(cached.org.currency);
          })
          .catch(() => {});
        return prev;
      });
    } finally {
      setLoading(false); // never leave the app stuck on the loading screen
    }
  };

  useEffect(() => {
    bindAuthAutoRefresh();
    refresh();
    if (!isSupabaseConfigured) return;

    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      // Only these actually change who is signed in. TOKEN_REFRESHED fires on a
      // timer with the same user, and INITIAL_SESSION fires the moment we
      // subscribe — the refresh() above already covers that.
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;

      // Deferred out of the callback on purpose. supabase-js holds an internal
      // auth lock for the duration of this handler, so calling another auth
      // method inside it (getOrgContext -> getSession) deadlocks the client and
      // every later Supabase call hangs forever — supabase/auth-js#762. That
      // was the "opens fine once, blank on every reopen after" bug: reopening
      // triggers startAutoRefresh -> TOKEN_REFRESHED -> refresh() -> deadlock.
      setTimeout(() => {
        void refresh();
      }, 0);
    });
    return () => data.subscription.unsubscribe();
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
