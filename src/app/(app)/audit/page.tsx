"use client";

import { RequireModule } from "@/components/guards";
import AuditLog from "@/views/AuditLog";

export default function Page() {
  return (
    <RequireModule id="audit">
      <AuditLog />
    </RequireModule>
  );
}
