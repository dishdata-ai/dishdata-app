"use client";

import { RequireModule } from "@/components/guards";
import Reports from "@/views/Reports";

export default function Page() {
  return (
    <RequireModule id="reports">
      <Reports />
    </RequireModule>
  );
}
