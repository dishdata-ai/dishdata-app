"use client";

import { RequireModule } from "@/components/guards";
import Settings from "@/views/Settings";

export default function Page() {
  return (
    <RequireModule id="settings">
      <Settings />
    </RequireModule>
  );
}
