"use client";

import { RequireModule } from "@/components/guards";
import Preorders from "@/views/Preorders";

export default function Page() {
  return (
    <RequireModule id="preorders">
      <Preorders />
    </RequireModule>
  );
}
