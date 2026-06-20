"use client";

import { RequireModule } from "@/components/guards";
import Finance from "@/views/Finance";

export default function Page() {
  return (
    <RequireModule id="finance">
      <Finance />
    </RequireModule>
  );
}
