"use client";

import { RequireModule } from "@/components/guards";
import Floor from "@/views/Floor";

export default function Page() {
  return (
    <RequireModule id="floor">
      <Floor />
    </RequireModule>
  );
}
