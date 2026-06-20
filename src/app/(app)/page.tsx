"use client";

import { RequireModule } from "@/components/guards";
import Dashboard from "@/views/Dashboard";

export default function Page() {
  return (
    <RequireModule id="dashboard">
      <Dashboard />
    </RequireModule>
  );
}
