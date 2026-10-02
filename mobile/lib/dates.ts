// Calendar helpers shared by shifts and availability — the same as the web app's, so a "week" means the same thing.

/** Local-calendar YYYY-MM-DD. toISOString() would shift the day for anyone east/west of UTC. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday→Sunday of the week `offset` weeks from the current one (0 = this week). */
export function weekDays(offset: number): Date[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** "15–21 Sep" style label for a week. */
export function weekLabel(days: Date[]): string {
  const a = days[0];
  const b = days[6];
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "short" });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`;
}

/** "16:00:00" (Postgres time) → "16:00". */
export const shortTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Hours between two "HH:MM" strings; a shorter end than start means an overnight shift. */
export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
}

/** YYYY-MM-DD of the Monday of the week containing `d`. */
export function weekStartKey(d: Date): string {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return dayKey(start);
}
