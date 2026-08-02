import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/hooks/useAuth";
import { fetchMyOrgContext } from "@/lib/api/orgs";
import { MODULES, defaultModulesFor } from "@/lib/modules";
import type { Org, Role } from "@/lib/api/database.types";

interface OrgContextValue {
  org: Org | null;
  role: Role | null;
  /** Modules this member can see = org-enabled ∩ member access. */
  moduleIds: Set<string>;
  loading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  /** Can see the partner task space (owners, admins and partners). */
  isPartner: boolean;
  refresh: () => void;
}

const OrgCtx = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orgContext", user?.id],
    queryFn: () => fetchMyOrgContext(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  const org = data?.org ?? null;
  const role = data?.role ?? null;

  // Org-level enabled modules (set during onboarding); default: all
  const enabled = new Set(
    (org?.settings?.enabled_modules as string[] | undefined) ?? MODULES.map((m) => m.id),
  );
  // Always-on essentials regardless of onboarding selection.
  // (loyalty was added after some orgs onboarded, so it isn't in their saved
  //  enabled_modules — force-enable it; member access still gates visibility.)
  enabled.add("dashboard");
  enabled.add("settings");
  enabled.add("myday");
  enabled.add("loyalty");
  enabled.add("marketing");
  enabled.add("orders"); // added after onboarding — force-enable like loyalty/marketing
  if (role === "owner" || role === "admin") {
    enabled.add("team");
    enabled.add("audit");
  }

  const memberAccess = new Set(
    data?.moduleIds?.length ? data.moduleIds : role ? defaultModulesFor(role) : [],
  );
  const moduleIds = new Set([...enabled].filter((m) => memberAccess.has(m)));

  const value: OrgContextValue = {
    org,
    role,
    moduleIds,
    loading: isLoading,
    isAdmin: role === "owner" || role === "admin",
    isManager: role === "owner" || role === "admin" || role === "manager",
    // mirrors can_see_partner_tasks() in the DB
    isPartner: role === "owner" || role === "admin" || role === "partner",
    refresh: () => qc.invalidateQueries({ queryKey: ["orgContext"] }),
  };

  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgCtx);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}

/** Convenience: org id that throws if used before org is loaded (repos need it). */
export function useOrgId(): string {
  const { org } = useOrg();
  if (!org) throw new Error("No active organization");
  return org.id;
}
