"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { SectionTitle, Card, Badge, EmptyState, PageSkeleton } from "@/components/ui";
import { useTasks } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { updateTask } from "@/lib/api/tasks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Task, StaffRole } from "@/lib/api/database.types";

const ROLE_LABELS: Record<StaffRole, string> = {
  frontend: "Frontend",
  kitchen_lead: "Kitchen Lead",
  commi_kitchen: "Commi Kitchen / Kitchen Helper",
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
};

const ROLE_TONES: Record<StaffRole, "green" | "amber" | "rose" | "violet" | "cyan" | "neutral"> = {
  frontend: "cyan",
  kitchen_lead: "amber",
  commi_kitchen: "violet",
  owner: "rose",
  admin: "rose",
  manager: "amber",
};

export default function DailyTasks() {
  const { org } = useOrg();
  const tasksQ = useTasks();
  const [expandedRole, setExpandedRole] = useState<StaffRole | null>(null);

  const dailyTasks = useMemo(() => {
    return (tasksQ.data ?? []).filter((t) => t.is_daily && !t.is_partner_task);
  }, [tasksQ.data]);

  const tasksByRole = useMemo(() => {
    const grouped = new Map<StaffRole | null, Task[]>();
    dailyTasks.forEach((task) => {
      const role = task.assigned_role;
      if (!grouped.has(role)) grouped.set(role, []);
      grouped.get(role)!.push(task);
    });
    return grouped;
  }, [dailyTasks]);

  const handleToggleTask = async (task: Task) => {
    try {
      const newStatus = task.status === "done" ? "todo" : "done";
      await updateTask(org!.id, task.id, { status: newStatus });
      toast.success(newStatus === "done" ? "Task completed" : "Task reopened", task.title);
    } catch (e) {
      toast.error("Could not update task", e instanceof Error ? e.message : "");
    }
  };

  if (tasksQ.isLoading) return <PageSkeleton />;

  const roles = Array.from(tasksByRole.keys()).filter((r) => r !== null) as StaffRole[];
  roles.sort();

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Daily Tasks"
        subtitle="Role-based daily checklists for staff to keep operations running smoothly"
      />

      {dailyTasks.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No daily tasks yet"
          hint="Create role-based daily checklists for your team"
        />
      ) : (
        <div className="space-y-4">
          {roles.map((role) => {
            const roleTasks = tasksByRole.get(role) || [];
            const isExpanded = expandedRole === role;
            const completedCount = roleTasks.filter((t) => t.status === "done").length;

            return (
              <Card key={role} className="overflow-hidden">
                <button
                  onClick={() => setExpandedRole(isExpanded ? null : role)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1 text-left">
                    <Badge tone={ROLE_TONES[role]}>
                      {ROLE_LABELS[role]}
                    </Badge>
                    <span className="text-sm text-zinc-400">
                      {completedCount} / {roleTasks.length} completed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-12 bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${(completedCount / roleTasks.length) * 100}%` }}
                      />
                    </div>
                    <svg
                      className={cn("h-5 w-5 text-zinc-400 transition-transform", isExpanded && "rotate-180")}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-700/50 divide-y divide-zinc-700/50">
                    {roleTasks.map((task) => (
                      <div
                        key={task.id}
                        className="px-4 py-3 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
                      >
                        <button
                          onClick={() => handleToggleTask(task)}
                          className="mt-0.5 flex-shrink-0 text-zinc-400 hover:text-white transition-colors"
                        >
                          {task.status === "done" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <h4
                            className={cn(
                              "font-medium text-sm",
                              task.status === "done" && "line-through text-zinc-500",
                            )}
                          >
                            {task.title}
                          </h4>
                          {task.description && (
                            <p className="text-xs text-zinc-400 mt-1">{task.description}</p>
                          )}
                        </div>
                        <Badge tone={task.priority === "high" ? "rose" : task.priority === "medium" ? "amber" : "neutral"} className="text-xs flex-shrink-0">
                          {task.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
