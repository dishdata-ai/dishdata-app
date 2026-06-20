"use client";

import { RequireModule } from "@/components/guards";
import Loyalty from "@/views/Loyalty";

export default function Page() {
  return (
    <RequireModule id="loyalty">
      <Loyalty />
    </RequireModule>
  );
}
