// localStorage-backed table store powering demo mode (no Supabase configured).
// Repositories branch here so every feature works offline / pre-backend.

import { uid } from "@/lib/utils";

const PREFIX = "dishdata-demo:";

function read<T>(name: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(name: string, rows: T[]) {
  localStorage.setItem(PREFIX + name, JSON.stringify(rows));
}

export interface DemoTable<T extends { id: string }> {
  list(filter?: Partial<T>): T[];
  get(id: string): T | undefined;
  insert(row: Omit<T, "id"> & { id?: string }): T;
  insertMany(rows: T[]): void;
  update(id: string, patch: Partial<T>): T | undefined;
  remove(id: string): void;
  setAll(rows: T[]): void;
}

export function demoTable<T extends { id: string }>(name: string): DemoTable<T> {
  return {
    list(filter) {
      let rows = read<T>(name);
      if (filter) {
        rows = rows.filter((r) =>
          Object.entries(filter).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        );
      }
      return rows;
    },
    get(id) {
      return read<T>(name).find((r) => r.id === id);
    },
    insert(row) {
      const rows = read<T>(name);
      const full = { ...row, id: row.id ?? uid() } as T;
      rows.unshift(full);
      write(name, rows);
      return full;
    },
    insertMany(newRows) {
      write(name, [...newRows, ...read<T>(name)]);
    },
    update(id, patch) {
      const rows = read<T>(name);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return undefined;
      rows[idx] = { ...rows[idx], ...patch };
      write(name, rows);
      return rows[idx];
    },
    remove(id) {
      write(name, read<T>(name).filter((r) => r.id !== id));
    },
    setAll(rows) {
      write(name, rows);
    },
  };
}

/** Small artificial latency so demo mode exercises loading states. */
export const demoDelay = () => new Promise<void>((r) => setTimeout(r, 80));

export function clearDemoData() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  }
}
