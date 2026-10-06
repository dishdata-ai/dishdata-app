"use client";

import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, CalendarHeart, Link2, Megaphone, Newspaper, Sparkles } from "lucide-react";
import { SectionTitle } from "@/components/ui";
import { cn } from "@/lib/utils";
import Campaigns from "@/views/marketing/Campaigns";
import Accounts from "@/views/marketing/Accounts";
import Planner from "@/views/marketing/Planner";
import Blog from "@/views/marketing/Blog";
import SiteEvents from "@/views/marketing/SiteEvents";
import WeeklyDish from "@/views/marketing/WeeklyDish";
import Traffic from "@/views/marketing/Traffic";

// Later phases add Inbox, Social, Shop and Insights tabs here.
const TABS = [
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "planner", label: "Planner", icon: CalendarDays },
  { id: "blog", label: "Blog", icon: Newspaper },
  { id: "week", label: "Dish of the week", icon: Sparkles },
  { id: "events", label: "Events", icon: CalendarHeart },
  { id: "traffic", label: "Website traffic", icon: BarChart3 },
  { id: "accounts", label: "Accounts", icon: Link2 },
] as const;

type Tab = (typeof TABS)[number]["id"];

const isTab = (v: string | null): v is Tab => TABS.some((t) => t.id === v);

export default function Marketing() {
  const [tab, setTab] = useState<Tab>("campaigns");

  // Deep links such as /marketing?tab=accounts (OAuth callbacks redirect here).
  // Read after mount rather than via useSearchParams, which would force a
  // Suspense boundary around the whole page.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (isTab(t)) setTab(t);
  }, []);

  const choose = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Marketing"
        subtitle="Campaigns to your customers, and the social accounts you reach them on."
      />

      <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-white/[0.02] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => choose(t.id)}
            className={cn(
              "inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
              tab === t.id
                ? "bg-gradient-to-r from-brand-500/15 to-accent-400/5 text-brand-300 ring-1 ring-brand-400/20"
                : "text-zinc-400 hover:text-white",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "campaigns" && <Campaigns />}
      {tab === "planner" && <Planner />}
      {tab === "blog" && <Blog />}
      {tab === "week" && <WeeklyDish />}
      {tab === "events" && <SiteEvents />}
      {tab === "traffic" && <Traffic />}
      {tab === "accounts" && <Accounts />}
    </div>
  );
}
