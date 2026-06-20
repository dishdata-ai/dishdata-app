import { useEffect, type ReactNode } from "react";
import { X, TrendingUp, TrendingDown, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 py-14 text-center", className)}>
      <div className="rounded-2xl bg-white/[0.04] p-3.5">
        <Icon className="h-6 w-6 text-zinc-500" />
      </div>
      <p className="mt-1 font-semibold text-white">{title}</p>
      {hint && <p className="max-w-xs text-sm text-zinc-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-white/[0.05]", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass rounded-2xl", className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white md:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" &&
          "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950 shadow-lg shadow-brand-500/20 hover:brightness-110",
        variant === "ghost" &&
          "border border-line bg-white/[0.03] text-zinc-200 hover:border-zinc-500 hover:bg-white/[0.06]",
        variant === "danger" && "bg-rose-soft/15 text-rose-soft hover:bg-rose-soft/25",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "green" | "amber" | "rose" | "violet" | "cyan" | "neutral";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    green: "bg-brand-400/10 text-brand-300 ring-brand-400/30",
    amber: "bg-amber-soft/10 text-amber-soft ring-amber-soft/30",
    rose: "bg-rose-soft/10 text-rose-soft ring-rose-soft/30",
    violet: "bg-violet-soft/10 text-violet-soft ring-violet-soft/30",
    cyan: "bg-accent-400/10 text-accent-400 ring-accent-400/30",
    neutral: "bg-white/5 text-zinc-300 ring-white/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  trend,
  trendGoodWhenDown = false,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  trend?: number;
  trendGoodWhenDown?: boolean;
}) {
  const isUp = trend !== undefined && trend >= 0;
  const isGood = trend !== undefined && (trendGoodWhenDown ? trend <= 0 : trend >= 0);
  return (
    <Card className="animate-rise p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{title}</p>
          <p className="mt-2 font-display text-2xl font-bold text-white">{value}</p>
        </div>
        <div className="rounded-xl bg-gradient-to-br from-brand-500/20 to-accent-400/10 p-2.5">
          <Icon className="h-5 w-5 text-brand-300" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        {trend !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-semibold",
              isGood ? "text-brand-300" : "text-rose-soft",
            )}
          >
            {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {Math.abs(trend)}%
          </span>
        )}
        {hint && <span className="text-zinc-500">{hint}</span>}
      </div>
    </Card>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          "animate-rise max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:p-6",
          wide ? "max-w-2xl" : "max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-line bg-white/[0.03] px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-brand-400/50 focus:ring-2 focus:ring-brand-400/20 focus:outline-none",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full cursor-pointer rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-zinc-100 focus:border-brand-400/50 focus:outline-none",
        props.className,
      )}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

export function ProgressBar({
  value,
  tone = "green",
  className,
}: {
  value: number;
  tone?: "green" | "amber" | "rose" | "cyan";
  className?: string;
}) {
  const tones = {
    green: "from-brand-500 to-brand-300",
    amber: "from-amber-soft to-yellow-300",
    rose: "from-rose-soft to-rose-300",
    cyan: "from-accent-400 to-cyan-300",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/5", className)}>
      <div
        className={cn("h-full rounded-full bg-gradient-to-r transition-all", tones[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-zinc-500 uppercase">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}

export const CHART_COLORS = ["#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa"];

export const chartTooltipStyle = {
  contentStyle: {
    background: "#181b25",
    border: "1px solid #262a38",
    borderRadius: 12,
    color: "#e4e4e7",
    fontSize: 13,
  },
  labelStyle: { color: "#a1a1aa" },
} as const;
