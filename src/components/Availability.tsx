"use client";

import { useState } from "react";
import { CalendarCheck, Check, Clock, X } from "lucide-react";
import { Card, Badge, Button, Input } from "@/components/ui";
import { useAvailability, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import {
  setAvailability,
  clearAvailability,
  dayKey,
  weekDays,
  weekLabel,
  shortTime,
} from "@/lib/api/availability";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { Employee, StaffAvailability, AvailabilityStatus } from "@/lib/api/database.types";

const STATUS_OPTIONS: { id: AvailabilityStatus; label: string; icon: typeof Check; active: string }[] = [
  { id: "available", label: "Available", icon: Check, active: "border-brand-400/40 bg-brand-500/15 text-brand-200" },
  { id: "partial", label: "Some hours", icon: Clock, active: "border-amber-soft/40 bg-amber-soft/10 text-amber-soft" },
  { id: "unavailable", label: "Off", icon: X, active: "border-rose-soft/40 bg-rose-soft/10 text-rose-soft" },
];

const DEFAULT_WINDOW = { from: "16:00", to: "23:00" };

function weekTabLabel(offset: number): string {
  if (offset === 0) return "This week";
  if (offset === 1) return "Next week";
  return weekLabel(weekDays(offset));
}

function WeekTabs({ offsets, value, onChange }: { offsets: number[]; value: number; onChange: (o: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {offsets.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn(
            "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-all",
            value === o
              ? "border border-brand-400/40 bg-brand-500/15 text-brand-200"
              : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
          )}
        >
          {weekTabLabel(o)}
        </button>
      ))}
    </div>
  );
}

function DayRow({
  orgId,
  employeeId,
  date,
  row,
  onSaved,
}: {
  orgId: string;
  employeeId: string;
  date: Date;
  row: StaffAvailability | undefined;
  onSaved: () => void;
}) {
  const key = dayKey(date);
  const [from, setFrom] = useState(shortTime(row?.from_time ?? null) || DEFAULT_WINDOW.from);
  const [to, setTo] = useState(shortTime(row?.to_time ?? null) || DEFAULT_WINDOW.to);
  const [note, setNote] = useState(row?.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (status: AvailabilityStatus | null) => {
    setSaving(true);
    try {
      if (status === null) await clearAvailability(orgId, employeeId, key);
      else await setAvailability(orgId, employeeId, key, { status, from_time: from, to_time: to, note });
      onSaved();
    } catch (e) {
      toast.error("Could not save availability", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // Times and note save on blur, and only if they actually changed — every
  // keystroke would otherwise be a round trip.
  const saveDetailsIfChanged = () => {
    if (!row) return;
    const changed =
      (row.status === "partial" && (from !== shortTime(row.from_time) || to !== shortTime(row.to_time))) ||
      note.trim() !== (row.note ?? "");
    if (changed) save(row.status);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3", saving && "opacity-60")}>
      <div className="w-20 shrink-0">
        <p className="text-sm font-semibold text-white">{date.toLocaleDateString(undefined, { weekday: "short" })}</p>
        <p className="text-xs text-zinc-500">{date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
      </div>
      <div className="flex gap-1.5">
        {STATUS_OPTIONS.map((opt) => {
          const active = row?.status === opt.id;
          return (
            <button
              key={opt.id}
              disabled={saving}
              // Tapping the active choice again clears it back to "not said".
              onClick={() => save(active ? null : opt.id)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all disabled:cursor-wait",
                active ? opt.active : "border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              <opt.icon className="h-3.5 w-3.5" /> {opt.label}
            </button>
          );
        })}
      </div>
      {row?.status === "partial" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="time"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onBlur={saveDetailsIfChanged}
            className="w-[6.5rem] py-1.5 text-xs"
            aria-label="Available from"
          />
          <span className="text-xs text-zinc-500">to</span>
          <Input
            type="time"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onBlur={saveDetailsIfChanged}
            className="w-[6.5rem] py-1.5 text-xs"
            aria-label="Available until"
          />
        </div>
      )}
      {row && (
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={saveDetailsIfChanged}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="Note (optional)"
          className="min-w-[8rem] flex-1 py-1.5 text-xs"
        />
      )}
    </div>
  );
}

/** Staff-facing: fill in your own availability for the weeks ahead. */
export function AvailabilityPlanner({ employee }: { employee: Employee }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const availabilityQ = useAvailability();
  const [offset, setOffset] = useState(1);
  const [filling, setFilling] = useState(false);

  const days = weekDays(offset);
  const mine = new Map(
    (availabilityQ.data ?? []).filter((r) => r.employee_id === employee.id).map((r) => [r.day, r]),
  );
  const unset = days.filter((d) => !mine.has(dayKey(d)));

  const fillRest = async () => {
    setFilling(true);
    try {
      for (const d of unset) await setAvailability(org!.id, employee.id, dayKey(d), { status: "available" });
      invalidate("staff_availability");
    } catch (e) {
      toast.error("Could not save availability", errorMessage(e));
    } finally {
      setFilling(false);
    }
  };

  return (
    <Card>
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-start gap-3">
          <div>
            <h3 className="font-semibold text-white">My Availability</h3>
            <p className="text-xs text-zinc-500">Let your manager know when you can work — shifts are planned from this.</p>
          </div>
          <Badge tone={unset.length === 0 ? "green" : "amber"} className="ml-auto shrink-0">
            {7 - unset.length}/7 days
          </Badge>
        </div>
        <WeekTabs offsets={[1, 2, 3, 4]} value={offset} onChange={setOffset} />
      </div>
      <div className="divide-y divide-line/60">
        {days.map((d) => {
          const row = mine.get(dayKey(d));
          return (
            <DayRow
              // Re-seed local time/note state whenever the saved row changes.
              key={`${dayKey(d)}-${row?.updated_at ?? "unset"}`}
              orgId={org!.id}
              employeeId={employee.id}
              date={d}
              row={row}
              onSaved={() => invalidate("staff_availability")}
            />
          );
        })}
      </div>
      {unset.length > 0 && (
        <div className="border-t border-line p-3">
          <Button variant="ghost" className="w-full text-xs" disabled={filling} onClick={fillRest}>
            <CalendarCheck className="h-4 w-4" />
            {unset.length === 7 ? "Available all week" : `Mark the other ${unset.length} days available`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Cell({ row }: { row: StaffAvailability | undefined }) {
  if (!row) return <span className="text-zinc-600">—</span>;
  const base = "inline-block whitespace-nowrap rounded-md px-1.5 py-1 text-[11px] font-semibold";
  const label =
    row.status === "available" ? (
      <span className={cn(base, "bg-brand-400/10 text-brand-300")}>All day</span>
    ) : row.status === "partial" ? (
      <span className={cn(base, "bg-amber-soft/10 text-amber-soft")}>
        {shortTime(row.from_time)}–{shortTime(row.to_time)}
      </span>
    ) : (
      <span className={cn(base, "bg-rose-soft/10 text-rose-soft")}>Off</span>
    );
  return (
    <span title={row.note ?? undefined} className="relative inline-block">
      {label}
      {row.note && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-400" />}
    </span>
  );
}

/** Manager-facing: everyone's availability for a week, to plan shifts against. */
export function AvailabilityBoard({ employees }: { employees: Employee[] }) {
  useRealtimeInvalidate("staff_availability", ["staff_availability"]);
  const availabilityQ = useAvailability();
  const [offset, setOffset] = useState(1);

  const days = weekDays(offset);
  const keys = days.map(dayKey);
  const byCell = new Map((availabilityQ.data ?? []).map((r) => [`${r.employee_id}|${r.day}`, r]));
  const missing = employees.filter((e) => !keys.some((k) => byCell.has(`${e.id}|${k}`)));

  return (
    <Card>
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-start gap-3">
          <CalendarCheck className="mt-0.5 h-4 w-4 text-accent-400" />
          <div>
            <h3 className="font-semibold text-white">Availability</h3>
            <p className="text-xs text-zinc-500">
              What your team entered in My Day · {weekLabel(days)}. A dot means they left a note — hover to read it.
            </p>
          </div>
        </div>
        <WeekTabs offsets={[0, 1, 2, 3, 4]} value={offset} onChange={setOffset} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-zinc-500">
              <th className="px-4 py-2 text-left font-medium">Employee</th>
              {days.map((d) => (
                <th key={dayKey(d)} className="px-2 py-2 text-center font-medium">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                  <span className="text-zinc-600">{d.getDate()}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2">
                  <p className="truncate font-medium text-white">{e.name}</p>
                  <p className="text-xs text-zinc-500">{e.role_title}</p>
                </td>
                {keys.map((k) => (
                  <td key={k} className="px-2 py-2 text-center">
                    <Cell row={byCell.get(`${e.id}|${k}`)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-xs">
              <td className="px-4 py-2 font-semibold text-zinc-400">Can work</td>
              {keys.map((k) => {
                const n = employees.filter((e) => {
                  const s = byCell.get(`${e.id}|${k}`)?.status;
                  return s === "available" || s === "partial";
                }).length;
                return (
                  <td key={k} className={cn("px-2 py-2 text-center font-semibold", n === 0 ? "text-zinc-600" : "text-brand-300")}>
                    {n}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="border-t border-line px-4 py-3 text-xs">
        {missing.length === 0 ? (
          <span className="text-brand-300">Everyone has filled in this week.</span>
        ) : (
          <span className="text-zinc-400">
            <span className="font-semibold text-amber-soft">Not filled in yet:</span>{" "}
            {missing.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                {e.name}
                {/* Without a linked login they can't open My Day to fill it in. */}
                {!e.user_id && <span className="text-zinc-600"> (no login linked)</span>}
              </span>
            ))}
          </span>
        )}
      </div>
    </Card>
  );
}
