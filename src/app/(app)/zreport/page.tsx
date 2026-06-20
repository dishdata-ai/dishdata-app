"use client";

import { RequireModule } from "@/components/guards";
import ZReport from "@/views/ZReport";

export default function Page() {
  return (
    <RequireModule id="zreport">
      <ZReport />
    </RequireModule>
  );
}
