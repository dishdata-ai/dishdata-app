"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RequireModule, FullScreenSpinner } from "@/components/guards";
import { useOrg } from "@/lib/hooks/useOrg";
import { MODULES } from "@/lib/modules";
import Dashboard from "@/views/Dashboard";

export default function Page() {
  const { moduleIds, loading } = useOrg();
  const router = useRouter();
  const canSeeDashboard = moduleIds.has("dashboard");

  // Members without the Dashboard (e.g. staff) land on their own page instead of a "No access" wall.
  const fallback = moduleIds.has("myday") ? "/my" : MODULES.find((m) => moduleIds.has(m.id))?.path;

  useEffect(() => {
    if (!loading && !canSeeDashboard && fallback) router.replace(fallback);
  }, [loading, canSeeDashboard, fallback, router]);

  if (loading || (!canSeeDashboard && fallback)) return <FullScreenSpinner />;

  return (
    <RequireModule id="dashboard">
      <Dashboard />
    </RequireModule>
  );
}
