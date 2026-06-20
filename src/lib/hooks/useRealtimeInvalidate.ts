import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { useOrg } from "@/lib/hooks/useOrg";

/**
 * Live updates: subscribes to Postgres changes for a table (scoped to the org)
 * and invalidates the given query domains. In demo mode, listens to the
 * `storage` event instead so two open tabs stay in sync.
 */
export function useRealtimeInvalidate(table: string, domains: string[]) {
  const { org } = useOrg();
  const qc = useQueryClient();

  useEffect(() => {
    if (!org) return;
    const invalidate = () => {
      for (const d of domains) qc.invalidateQueries({ queryKey: ["org", org.id, d] });
    };

    if (!isSupabaseConfigured) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === `dishdata-demo:${table}`) invalidate();
      };
      window.addEventListener("storage", onStorage);
      return () => window.removeEventListener("storage", onStorage);
    }

    const channel = getSupabase()
      .channel(`rt-${table}-${org.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `org_id=eq.${org.id}` },
        invalidate,
      )
      .subscribe();
    return () => {
      getSupabase().removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id, table]);
}
