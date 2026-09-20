"use client";

import { RequireModule } from "@/components/guards";
import DailyTasks from "@/views/DailyTasks";

export default function DailyTasksPage() {
  return (
    <RequireModule id="dailytasks">
      <DailyTasks />
    </RequireModule>
  );
}
