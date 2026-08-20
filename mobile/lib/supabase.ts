import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Expo inlines any env var prefixed with EXPO_PUBLIC_ at build time.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True when real Supabase credentials are present; false = demo mode. */
export const isSupabaseConfigured = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

/**
 * Native Supabase client — session persisted in AsyncStorage (not cookies, unlike web).
 * Mirrors the web repo guard: callers branch on isSupabaseConfigured before using this.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured) throw new Error("Supabase is not configured");
    client = createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

// Keep the session fresh while the app is foregrounded (per Supabase RN guidance).
let appStateBound = false;
export function bindAuthAutoRefresh() {
  if (appStateBound || !isSupabaseConfigured) return;
  appStateBound = true;
  const sb = getSupabase();
  // AppState only fires on a *change*, and the app is already "active" at cold
  // start — without this the refresh timer never starts until the app has been
  // backgrounded once.
  if (AppState.currentState === "active") sb.auth.startAutoRefresh();
  AppState.addEventListener("change", (state) => {
    if (state === "active") sb.auth.startAutoRefresh();
    else sb.auth.stopAutoRefresh();
  });
}
