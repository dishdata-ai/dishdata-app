import { create } from "zustand";
import { uid } from "@/lib/utils";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  title: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-5) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (title: string, detail?: string) => useToastStore.getState().push({ title, detail, tone: "success" }),
  error: (title: string, detail?: string) => useToastStore.getState().push({ title, detail, tone: "error" }),
  info: (title: string, detail?: string) => useToastStore.getState().push({ title, detail, tone: "info" }),
};
