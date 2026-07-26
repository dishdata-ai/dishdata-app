"use client";

import { RequireModule } from "@/components/guards";
import Orders from "@/views/Orders";

export default function Page() {
  return (
    <RequireModule id="orders">
      <Orders />
    </RequireModule>
  );
}
