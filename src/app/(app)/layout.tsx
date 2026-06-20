"use client";

import type { ReactNode } from "react";
import { OrgProvider } from "@/lib/hooks/useOrg";
import { RequireAuth, RequireOrg } from "@/components/guards";
import Layout from "@/components/Layout";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <OrgProvider>
        <RequireOrg>
          <Layout>{children}</Layout>
        </RequireOrg>
      </OrgProvider>
    </RequireAuth>
  );
}
