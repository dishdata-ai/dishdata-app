"use client";

import { RequireModule } from "@/components/guards";
import Till from "@/views/Till";

export default function Page() {
  return (
    <RequireModule id="till">
      <Till />
    </RequireModule>
  );
}
