"use client";

import { RequireModule } from "@/components/guards";
import Team from "@/views/Team";

export default function Page() {
  return (
    <RequireModule id="team">
      <Team />
    </RequireModule>
  );
}
