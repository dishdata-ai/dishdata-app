"use client";

import { RequireModule } from "@/components/guards";
import Pos from "@/views/Pos";

export default function Page() {
  return (
    <RequireModule id="pos">
      <Pos />
    </RequireModule>
  );
}
