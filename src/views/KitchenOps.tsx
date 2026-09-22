"use client";

import { useState } from "react";
import { SectionTitle, Select, PageSkeleton } from "@/components/ui";
import { useKitchenOps } from "@/views/kitchenops/useKitchenOps";
import LiveKitchen from "@/views/kitchenops/LiveKitchen";
import TodayPrep from "@/views/kitchenops/TodayPrep";
import MenuMethods from "@/views/kitchenops/MenuMethods";
import HourlyForecast from "@/views/kitchenops/HourlyForecast";
import StockReplenishment from "@/views/kitchenops/StockReplenishment";
import ServiceSpeed from "@/views/kitchenops/ServiceSpeed";
import Waste from "@/views/kitchenops/Waste";
import DailyReview from "@/views/kitchenops/DailyReview";
import WeeklyAnalysis from "@/views/kitchenops/WeeklyAnalysis";
import Standards from "@/views/kitchenops/Standards";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "live", label: "Live Kitchen" },
  { id: "prep", label: "Today's Prep" },
  { id: "methods", label: "Menu & Methods" },
  { id: "forecast", label: "Hourly Forecast" },
  { id: "stock", label: "Stock & Replenishment" },
  { id: "speed", label: "Service Speed" },
  { id: "waste", label: "Waste" },
  { id: "review", label: "Daily Review" },
  { id: "weekly", label: "Weekly Analysis" },
  { id: "standards", label: "Recipe & Portion Standards" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function KitchenOps() {
  const [tab, setTab] = useState<TabId>("live");
  const [multiplier, setMultiplier] = useState(1);
  const k = useKitchenOps(multiplier);

  if (k.loading) return <PageSkeleton />;

  const learning = k.model.serviceDays < 14;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Kitchen Ops"
        subtitle="What we have, what's running out, what to make next — and how much."
        action={
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            Busy-day factor
            <Select value={String(multiplier)} onChange={(e) => setMultiplier(Number(e.target.value))} className="w-28 py-1.5 text-xs">
              <option value="0.8">Quiet ×0.8</option>
              <option value="1">Normal ×1</option>
              <option value="1.25">Busy ×1.25</option>
              <option value="1.5">Very busy ×1.5</option>
            </Select>
          </label>
        }
      />

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
              tab === t.id ? "bg-brand-400/15 text-brand-300 ring-1 ring-brand-400/30" : "bg-white/[0.04] text-zinc-400 hover:text-white",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {learning && (
        <p className="rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
          Learning from {k.model.serviceDays} service day{k.model.serviceDays === 1 ? "" : "s"} of sales — forecasts sharpen as more days come in (about 3–4 weeks gives a solid weekday pattern).
        </p>
      )}

      {tab === "live" && <LiveKitchen k={k} />}
      {tab === "prep" && <TodayPrep k={k} multiplier={multiplier} />}
      {tab === "methods" && <MenuMethods k={k} />}
      {tab === "forecast" && <HourlyForecast k={k} multiplier={multiplier} />}
      {tab === "stock" && <StockReplenishment k={k} />}
      {tab === "speed" && <ServiceSpeed k={k} />}
      {tab === "waste" && <Waste k={k} />}
      {tab === "review" && <DailyReview k={k} />}
      {tab === "weekly" && <WeeklyAnalysis k={k} multiplier={multiplier} />}
      {tab === "standards" && <Standards k={k} />}
    </div>
  );
}
