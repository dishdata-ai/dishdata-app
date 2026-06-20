"use client";

import { RequireModule } from "@/components/guards";
import Delivery from "@/views/Delivery";

export default function Page() {
  return (
    <RequireModule id="delivery">
      <Delivery />
    </RequireModule>
  );
}
