"use client";

import { RequireModule } from "@/components/guards";
import Sales from "@/views/Sales";

export default function Page() {
  return (
    <RequireModule id="sales">
      <Sales />
    </RequireModule>
  );
}
