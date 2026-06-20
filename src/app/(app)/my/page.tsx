"use client";

import { RequireModule } from "@/components/guards";
import MyDay from "@/views/MyDay";

export default function Page() {
  return (
    <RequireModule id="myday">
      <MyDay />
    </RequireModule>
  );
}
