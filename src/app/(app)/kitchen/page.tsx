"use client";

import { RequireModule } from "@/components/guards";
import Kitchen from "@/views/Kitchen";

export default function Page() {
  return (
    <RequireModule id="kitchen">
      <Kitchen />
    </RequireModule>
  );
}
