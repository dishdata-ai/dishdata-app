import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useToastStore, type ToastTone } from "@/lib/toast";
import { cn } from "@/lib/utils";

const toneStyles: Record<ToastTone, { icon: typeof Info; bar: string; text: string }> = {
  success: { icon: CheckCircle2, bar: "bg-brand-400", text: "text-brand-300" },
  error: { icon: AlertTriangle, bar: "bg-rose-soft", text: "text-rose-soft" },
  info: { icon: Info, bar: "bg-accent-400", text: "text-accent-400" },
};

export default function Toaster() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const s = toneStyles[t.tone];
        return (
          <div
            key={t.id}
            className="animate-rise pointer-events-auto relative overflow-hidden rounded-xl border border-line bg-raised shadow-2xl"
          >
            <div className={cn("absolute inset-y-0 left-0 w-1", s.bar)} />
            <div className="flex items-start gap-3 p-3.5 pl-4">
              <s.icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.text)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{t.title}</p>
                {t.detail && <p className="mt-0.5 text-xs text-zinc-400">{t.detail}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="cursor-pointer rounded p-0.5 text-zinc-500 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
