"use client";

import { RequireModule } from "@/components/guards";
import Payroll from "@/views/Payroll";

export default function Page() {
  return (
    <RequireModule id="payroll">
      <Payroll />
    </RequireModule>
  );
}
