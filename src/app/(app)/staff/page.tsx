"use client";

import { RequireModule } from "@/components/guards";
import Staff from "@/views/Staff";

export default function Page() {
  return (
    <RequireModule id="staff">
      <Staff />
    </RequireModule>
  );
}
