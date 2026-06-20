"use client";

import { RequireModule } from "@/components/guards";
import Tasks from "@/views/Tasks";

export default function Page() {
  return (
    <RequireModule id="tasks">
      <Tasks />
    </RequireModule>
  );
}
