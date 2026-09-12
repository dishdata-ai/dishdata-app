"use client";

import { useState } from "react";
import { CalendarCheck, Check, Clock, Trash2, X } from "lucide-react";
import { Card, Badge, Button, Input, Field, Modal } from "@/components/ui";
import { useAvailability, useShifts, useInvalidate } from "@/lib/hooks/data";
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
import { setShift, removeShift } from "@/lib/api/shifts";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";
import type { Employee, StaffAvailability, AvailabilityStatus, Shift } from "@/lib/api/database.types";

const STATUS_OPTIONS: { id: AvailabilityStatus; label: string; icon: typeof Check; active: string }[] = [
  { id: "available", label: "Available", icon: Check, active: "border-brand-400/40 bg-brand-500/15 text-brand-200" },
  { id: "partial", label: "Some hours", icon: Clock, active: "border-amber-soft/40 bg-amber-soft/10 text-amber-soft" },
  { id: "unavailable", label: "Off", icon: X, active: "border-rose-soft/40 bg-rose-soft/10 text-rose-soft" },
];

const DEFAULT_WINDOW = { from: "16:00", to: "23:00" };

/** Short summary of an availability row for showing next to a shift form. */
function availabilitySummary(row: StaffAvailability | undefined): string {
  if (!row) return "Hasn't said yet";
  if (row.status === "available") return "Marked available all day";
  if (row.status === "unavailable") return "Marked unavailable";
  return `Available ${shortTime(row.from_time)}–${shortTime(row.to_time)}`;
}

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

function AvailabilityHint({ row }: { row: StaffAvailability | undefined }) {
  if (!row) return <span className="text-zinc-600">—</span>;
  const tone =
    row.status === "available" ? "text-brand-300" : row.status === "partial" ? "text-amber-soft" : "text-rose-soft";
  const text = row.status === "available" ? "All day" : row.status === "partial" ? "Some hours" : "Off";
  return (
    <span title={row.note ?? undefined} className={cn("relative inline-block", tone)}>
      {text}
      {row.note && <span className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent-400" />}
    </span>
  );
}

/** One employee×day cell: the availability hint plus the assigned shift, if any. */
function ScheduleCell({
  availability,
  shift,
  onClick,
}: {
  availability: StaffAvailability | undefined;
  shift: Shift | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full cursor-pointer flex-col items-center gap-0.5 rounded-lg px-1.5 py-1 text-center transition-colors hover:bg-white/[0.04]"
    >
      {shift ? (
        <span className="inline-flex flex-col items-center rounded-md bg-brand-400/10 px-1.5 py-1 text-[11px] font-semibold text-brand-200">
          <span>{shortTime(shift.start_time)}–{shortTime(shift.end_time)}</span>
          {shift.role_title && <span className="font-normal text-brand-300/80">{shift.role_title}</span>}
        </span>
      ) : (
        <span className="text-sm text-zinc-700 group-hover:text-zinc-500">+</span>
      )}
      <span className="text-[10px]">
        <AvailabilityHint row={availability} />
      </span>
    </button>
  );
}

function ShiftModal({
  employee,
  date,
  shift,
  availability,
  orgId,
  onClose,
  onSaved,
}: {
  employee: Employee;
  date: Date;
  shift: Shift | undefined;
  availability: StaffAvailability | undefined;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default the shift window to the hours they actually said they can work.
  const suggested =
    availability?.status === "partial"
      ? { from: shortTime(availability.from_time), to: shortTime(availability.to_time) }
      : DEFAULT_WINDOW;
  const [start, setStart] = useState(shift ? shortTime(shift.start_time) : suggested.from);
  const [end, setEnd] = useState(shift ? shortTime(shift.end_time) : suggested.to);
  const [role, setRole] = useState(shift?.role_title ?? employee.role_title);
  const [note, setNote] = useState(shift?.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      if (availability?.status === "unavailable") {
        toast.error(`${employee.name.split(" ")[0]} marked this day off`, "Saved anyway — double-check with them.");
      }
      await setShift(orgId, employee.id, dayKey(date), {
        start_time: start,
        end_time: end,
        role_title: role,
        note,
      });
      onSaved();
      onClose();
    } catch (e) {
      toast.error("Could not save shift", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    setSaving(true);
    try {
      await removeShift(orgId, employee.id, dayKey(date));
      onSaved();
      onClose();
    } catch (e) {
      toast.error("Could not remove shift", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${shift ? "Edit" : "Add"} shift · ${employee.name.split(" ")[0]}`}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
          <span className="text-zinc-400">
            {date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
          </span>
          <span
            className={cn(
              "font-semibold",
              availability?.status === "unavailable"
                ? "text-rose-soft"
                : availability?.status === "partial"
                  ? "text-amber-soft"
                  : availability?.status === "available"
                    ? "text-brand-300"
                    : "text-zinc-500",
            )}
          >
            {availabilitySummary(availability)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Role / station (optional)">
          <Input value={role ?? ""} onChange={(e) => setRole(e.target.value)} placeholder={employee.role_title} />
        </Field>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. covering the pass" />
        </Field>
        <div className="flex gap-2">
          {shift && (
            <Button variant="danger" disabled={saving} onClick={del}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
          <Button className="flex-1" disabled={saving || !start || !end} onClick={save}>
            {shift ? "Save changes" : "Assign shift"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Manager-facing: the week's availability and assigned shifts, side by side, editable. */
export function AvailabilityBoard({ employees }: { employees: Employee[] }) {
  useRealtimeInvalidate("staff_availability", ["staff_availability"]);
  useRealtimeInvalidate("shifts", ["shifts"]);
  const { org } = useOrg();
  const availabilityQ = useAvailability();
  const shiftsQ = useShifts();
  const invalidate = useInvalidate();
  const [offset, setOffset] = useState(1);
  const [editing, setEditing] = useState<{ employee: Employee; date: Date } | null>(null);

  const days = weekDays(offset);
  const keys = days.map(dayKey);
  const byAvailability = new Map((availabilityQ.data ?? []).map((r) => [`${r.employee_id}|${r.day}`, r]));
  const byShift = new Map((shiftsQ.data ?? []).map((r) => [`${r.employee_id}|${r.day}`, r]));
  const missing = employees.filter((e) => !keys.some((k) => byAvailability.has(`${e.id}|${k}`)));

  return (
    <Card>
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-start gap-3">
          <CalendarCheck className="mt-0.5 h-4 w-4 text-accent-400" />
          <div>
            <h3 className="font-semibold text-white">Schedule</h3>
            <p className="text-xs text-zinc-500">
              Click a day to assign a shift · {weekLabel(days)}. The small line under each cell is what they told you they can work.
            </p>
          </div>
        </div>
        <WeekTabs offsets={[0, 1, 2, 3, 4]} value={offset} onChange={setOffset} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
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
                {days.map((d, i) => {
                  const k = keys[i];
                  return (
                    <td key={k} className="px-1 py-1 text-center">
                      <ScheduleCell
                        availability={byAvailability.get(`${e.id}|${k}`)}
                        shift={byShift.get(`${e.id}|${k}`)}
                        onClick={() => setEditing({ employee: e, date: d })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-xs">
              <td className="px-4 py-2 font-semibold text-zinc-400">Scheduled</td>
              {keys.map((k) => {
                const n = employees.filter((e) => byShift.has(`${e.id}|${k}`)).length;
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
          <span className="text-brand-300">Everyone has filled in their availability this week.</span>
        ) : (
          <span className="text-zinc-400">
            <span className="font-semibold text-amber-soft">Availability not filled in yet:</span>{" "}
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
      {editing && (
        <ShiftModal
          employee={editing.employee}
          date={editing.date}
          shift={byShift.get(`${editing.employee.id}|${dayKey(editing.date)}`)}
          availability={byAvailability.get(`${editing.employee.id}|${dayKey(editing.date)}`)}
          orgId={org!.id}
          onClose={() => setEditing(null)}
          onSaved={() => invalidate("shifts")}
        />
      )}
    </Card>
  );
}
