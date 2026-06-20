"use client";

import { RequireModule } from "@/components/guards";
import Insights from "@/views/Insights";

export default function Page() {
  return (
    <RequireModule id="insights">
      <Insights />
    </RequireModule>
  );
}
