"use client";

import { RequireModule } from "@/components/guards";
import Channels from "@/views/Channels";

export default function Page() {
  return (
    <RequireModule id="channels">
      <Channels />
    </RequireModule>
  );
}
