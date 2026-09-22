"use client";

import { RequireModule } from "@/components/guards";
import KitchenOps from "@/views/KitchenOps";

export default function KitchenOpsPage() {
  return (
    <RequireModule id="kitchenops">
      <KitchenOps />
    </RequireModule>
  );
}
