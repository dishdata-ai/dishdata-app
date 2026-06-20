"use client";

import { RequireModule } from "@/components/guards";
import Inventory from "@/views/Inventory";

export default function Page() {
  return (
    <RequireModule id="inventory">
      <Inventory />
    </RequireModule>
  );
}
