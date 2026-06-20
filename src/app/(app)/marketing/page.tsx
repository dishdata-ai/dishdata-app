"use client";

import { RequireModule } from "@/components/guards";
import Marketing from "@/views/Marketing";

export default function Page() {
  return (
    <RequireModule id="marketing">
      <Marketing />
    </RequireModule>
  );
}
