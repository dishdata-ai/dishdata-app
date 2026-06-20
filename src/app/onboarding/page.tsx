"use client";

import { OrgProvider } from "@/lib/hooks/useOrg";
import { RequireAuth } from "@/components/guards";
import Onboarding from "@/views/Onboarding";

export default function OnboardingPage() {
  return (
    <RequireAuth>
      <OrgProvider>
        <Onboarding />
      </OrgProvider>
    </RequireAuth>
  );
}
