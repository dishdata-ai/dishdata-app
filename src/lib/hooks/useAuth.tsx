import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  isDemo: boolean;
  /** Returns an error message or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>;
  /** Returns an error message or null on success. */
  signUp: (email: string, password: string, fullName: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const DEMO_USER: AuthUser = { id: "demo-user", email: "demo@dishdata.app", fullName: "Demo Owner" };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(isSupabaseConfigured ? null : DEMO_USER);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setUser(u ? { id: u.id, email: u.email ?? "", fullName: u.user_metadata?.full_name } : null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? "", fullName: u.user_metadata?.full_name } : null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured) return null;
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!isSupabaseConfigured) return null;
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return error.message;
    if (!data.session) {
      return "Account created — check your email to confirm, then sign in. (Tip: disable email confirmation in Supabase Auth settings during development.)";
    }
    return null;
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) return;
    await getSupabase().auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, isDemo: !isSupabaseConfigured, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
