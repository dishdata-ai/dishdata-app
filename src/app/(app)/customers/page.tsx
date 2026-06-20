"use client";

import { RequireModule } from "@/components/guards";
import Customers from "@/views/Customers";

export default function Page() {
  return (
    <RequireModule id="crm">
      <Customers />
    </RequireModule>
  );
}
