"use client";

import { RequireModule } from "@/components/guards";
import Procurement from "@/views/Procurement";

export default function Page() {
  return (
    <RequireModule id="procurement">
      <Procurement />
    </RequireModule>
  );
}
