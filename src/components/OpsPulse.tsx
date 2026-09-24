"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Flame, UserX } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { useTasks, useDuties, useEmployees, useMembers, useOrders, useKitchenDishes } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { DUTY_ROLES, DUTY_LABELS } from "@/lib/api/duties";
import { isDoneToday } from "@/lib/daily";
import { cn } from "@/lib/utils";

/** "Operations today" — how the day's checklists and the kitchen line are going, for owners and managers. */
export default function OpsPulse() {
  const { moduleIds } = useOrg();
  const tasksQ = useTasks();
  const dutiesQ = useDuties();
  const employeesQ = useEmployees();
  const membersQ = useMembers();
  const ordersQ = useOrders();
  const bainQ = useKitchenDishes();

  const data = useMemo(() => {
    const daily = (tasksQ.data ?? []).filter((t) => t.is_daily && !t.is_partner_task);
    const employees = employeesQ.data ?? [];
    const nameOf = (d: { employee_id: string | null; user_id: string | null }) => {
      if (d.employee_id) return employees.find((e) => e.id === d.employee_id)?.name;
      const linked = employees.find((e) => e.user_id === d.user_id);
      if (linked) return linked.name;
      const m = (membersQ.data ?? []).find((x) => x.user_id === d.user_id);
      return m?.full_name || m?.email || undefined;
    };
    const rows = DUTY_ROLES.map((duty) => {
      const tasks = daily.filter((t) => t.assigned_role === duty);
      const holders = (dutiesQ.data ?? []).filter((d) => d.duty === duty).map(nameOf).filter(Boolean) as string[];
      const done = tasks.filter(isDoneToday).length;
      const urgentLeft = tasks.filter((t) => !isDoneToday(t) && t.priority === "high").length;
      return { duty, total: tasks.length, done, urgentLeft, holders };
    }).filter((r) => r.total > 0);
    const unassigned = daily.filter((t) => !t.assigned_role && !isDoneToday(t)).length;
    const total = daily.length;
    const done = daily.filter(isDoneToday).length;

    const now = Date.now();
    const open = (ordersQ.data ?? []).filter(
      (o) => o.kitchen_status !== "served" && o.status !== "void" && now - new Date(o.created_at).getTime() < 12 * 3600000,
    );
    const ages = open.map((o) => Math.floor((now - new Date(o.created_at).getTime()) / 60000));
    return {
      rows, unassigned, total, done,
      kitchen: { open: open.length, oldest: ages.length ? Math.max(...ages) : 0, late: ages.filter((a) => a >= 15).length },
    };
  }, [tasksQ.data, dutiesQ.data, employeesQ.data, membersQ.data, ordersQ.data]);

  if (data.total === 0) return null;
  const lowDishes = (bainQ.data ?? []).filter((i) => i.is_active && i.bain_marie === "yes" && i.hot_portions <= i.reorder_at);
  const pct = Math.round((data.done / data.total) * 100);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-brand-300" />
          <h3 className="font-semibold text-white">Operations today</h3>
          <Badge tone={pct === 100 ? "green" : pct >= 50 ? "amber" : "neutral"}>{pct}% of checklists done</Badge>
        </div>
        {moduleIds.has("dailytasks") && (
          <Link href="/tasks?view=daily" className="inline-flex items-center gap-1 text-sm text-accent-400 hover:underline">
            Open checklists <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {data.rows.map((r) => (
            <div key={r.duty}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-white">{DUTY_LABELS[r.duty]}</span>
                <span className="text-xs text-zinc-400">
                  {r.done}/{r.total}
                  {r.urgentLeft > 0 && <span className="ml-2 text-rose-soft">{r.urgentLeft} high-priority left</span>}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-brand-400 transition-all" style={{ width: `${(r.done / r.total) * 100}%` }} />
              </div>
              <p className={cn("mt-1 text-xs", r.holders.length ? "text-zinc-500" : "flex items-center gap-1 text-amber-soft")}>
                {r.holders.length ? r.holders.join(", ") : (<><UserX className="h-3 w-3" /> Nobody holds this duty yet</>)}
              </p>
            </div>
          ))}
          {data.unassigned > 0 && (
            <p className="text-xs text-amber-soft">
              {data.unassigned} unassigned task{data.unassigned > 1 ? "s" : ""} still open — nobody owns them yet.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Flame className="h-4 w-4 text-brand-300" /> Kitchen line
          </div>
          {data.kitchen.open === 0 ? (
            <p className="text-sm text-zinc-400">Line is clear.</p>
          ) : (
            <div className="space-y-1 text-sm text-zinc-300">
              <p>{data.kitchen.open} open ticket{data.kitchen.open > 1 ? "s" : ""}</p>
              <p className="text-xs text-zinc-500">Oldest waiting {data.kitchen.oldest} min</p>
              {data.kitchen.late > 0 && <p className="text-xs font-semibold text-rose-soft">{data.kitchen.late} waiting 15+ min</p>}
            </div>
          )}
          {lowDishes.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-soft">
              Bain-marie low: {lowDishes.map((d) => `${d.dish} (${d.hot_portions})`).join(", ")}
            </p>
          )}
          {moduleIds.has("kitchen") && (
            <Link href="/kitchen" className="mt-3 inline-flex items-center gap-1 text-xs text-accent-400 hover:underline">
              Open kitchen <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
