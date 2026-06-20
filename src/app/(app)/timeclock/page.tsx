"use client";

import { RequireModule } from "@/components/guards";
import TimeClock from "@/views/TimeClock";

export default function Page() {
  return (
    <RequireModule id="timeclock">
      <TimeClock />
    </RequireModule>
  );
}
