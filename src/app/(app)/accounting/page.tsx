"use client";

import { RequireModule } from "@/components/guards";
import Accounting from "@/views/Accounting";

export default function Page() {
  return (
    <RequireModule id="accounting">
      <Accounting />
    </RequireModule>
  );
}
