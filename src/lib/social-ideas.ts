// "What to do next" for the social planner: plain rules over the pipeline, the weekly targets and
// what actually sells. No AI calls — every suggestion says why it is being made.

import type { KitchenDish, Order, SocialFormat, SocialPlatform, SocialPost, SocialTarget } from "@/lib/api/database.types";
import { matchDishes } from "@/lib/kitchen-ops";

export interface IdeaDraft {
  title: string;
  platform: SocialPlatform;
  format: SocialFormat;
  caption: string;
}

export interface Suggestion {
  id: string;
  tone: "rose" | "amber" | "green" | "neutral";
  title: string;
  detail: string;
  idea?: IdeaDraft;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Portions sold per component over the last `days` days (falls back to raw line names when no components are set up). */
export function topSellers(orders: Order[], dishes: KitchenDish[], days = 14, now = Date.now()): { name: string; qty: number }[] {
  const totals = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "void" || o.status === "refunded" || now - new Date(o.created_at).getTime() > days * 86400000) continue;
    for (const l of o.items) {
      const names = dishes.length ? matchDishes(l.name, dishes).map((d) => d.dish) : [l.name];
      for (const n of names) totals.set(n, (totals.get(n) ?? 0) + l.qty);
    }
  }
  return [...totals.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
}

const EVERGREEN: (IdeaDraft & { key: string })[] = [
  { key: "bts-porotta", title: "Behind the scenes: porotta on the tawa", platform: "tiktok", format: "reel", caption: "Fresh from the tawa — flaky, layered, made in front of you. #porotta #keralafood #berlin" },
  { key: "team", title: "Meet the team: our favourite dish", platform: "instagram", format: "reel", caption: "Who cooks what at Kokoland — and what they eat on their day off." },
  { key: "explain", title: "Kerala food explained: what is puttu?", platform: "instagram", format: "post", caption: "Steamed rice-and-coconut cylinders, the classic Kerala breakfast — and how we serve it in the evening." },
  { key: "poll", title: "Story poll: pick our next special", platform: "instagram", format: "story", caption: "Beef fry or paneer? You choose what goes on the board this weekend." },
  { key: "review", title: "Reshare a guest review", platform: "instagram", format: "story", caption: "Kind words from our guests — thank you!" },
  { key: "delivery", title: "Order from home: Wolt & Uber Eats", platform: "facebook", format: "post", caption: "Can't make it in? Kokoland is on Wolt and Uber Eats." },
  { key: "google", title: "Google Business: hours and this week's specials", platform: "google", format: "post", caption: "Open Tuesday to Sunday — this week's specials and opening hours." },
  { key: "weekend", title: "Weekend teaser: what's cooking Friday–Sunday", platform: "instagram", format: "post", caption: "The weekend is our busiest time — here's what to expect." },
];

const EVENTS: { key: string; label: string; date: string }[] = [
  { key: "diwali", label: "Diwali", date: "2026-11-08" },
  { key: "christmas", label: "Christmas", date: "2026-12-25" },
];

export function suggest(opts: {
  posts: SocialPost[];
  targets: SocialTarget[];
  orders: Order[];
  dishes: KitchenDish[];
  weekDays: Date[];
  now?: Date;
}): Suggestion[] {
  const now = opts.now ?? new Date();
  const out: Suggestion[] = [];
  const keys = new Set(opts.weekDays.map(dayKey));
  const inWeek = opts.posts.filter((p) => p.scheduled_for && keys.has(p.scheduled_for) && (p.status === "scheduled" || p.status === "posted"));

  // 1. Behind target this week
  for (const t of opts.targets) {
    if (t.posts_per_week <= 0) continue;
    const n = inWeek.filter((p) => p.platform === t.platform).length;
    if (n < t.posts_per_week) {
      out.push({
        id: `target-${t.platform}`, tone: n === 0 ? "rose" : "amber",
        title: `${labelOf(t.platform)}: ${n} of ${t.posts_per_week} posts planned this week`,
        detail: `${t.posts_per_week - n} more to schedule to hit the weekly target.`,
      });
    }
  }

  // 2. Nothing in the next 3 days
  const soon = new Set([0, 1, 2].map((i) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i))));
  if (!opts.posts.some((p) => p.scheduled_for && soon.has(p.scheduled_for) && (p.status === "scheduled" || p.status === "drafted"))) {
    out.push({ id: "empty-3d", tone: "amber", title: "Nothing planned for the next 3 days", detail: "Schedule at least one post so the feed doesn't go quiet." });
  }

  // 3. Unowned posts and idea pile-up
  const unowned = opts.posts.filter((p) => !p.owner_user_id && p.status !== "posted").length;
  if (unowned > 0) out.push({ id: "unowned", tone: "amber", title: `${unowned} post${unowned > 1 ? "s" : ""} without an owner`, detail: "Give each post a person so it actually gets made." });
  const ideas = opts.posts.filter((p) => p.status === "idea").length;
  if (ideas >= 6) out.push({ id: "ideas", tone: "neutral", title: `${ideas} ideas waiting`, detail: "Pick the best one and draft it today." });

  // 4. Spotlight what sells
  for (const s of topSellers(opts.orders, opts.dishes).slice(0, 2)) {
    if (s.qty < 3) continue;
    const title = `Dish spotlight: ${s.name}`;
    if (opts.posts.some((p) => p.title === title)) continue;
    out.push({
      id: `spot-${s.name}`, tone: "green", title, detail: `${s.name} is one of your top sellers — ${s.qty} portions in the last 14 days. Show it off.`,
      idea: { title, platform: "instagram", format: "reel", caption: `${s.name} — a guest favourite at Kokoland. Come hungry.` },
    });
  }

  // 5. Upcoming festivals
  for (const ev of EVENTS) {
    const days = Math.ceil((new Date(ev.date).getTime() - now.getTime()) / 86400000);
    if (days > 0 && days <= 45) {
      const title = `${ev.label} post`;
      if (opts.posts.some((p) => p.title === title)) continue;
      out.push({
        id: `ev-${ev.key}`, tone: "green", title: `${ev.label} is in ${days} days`, detail: "Plan the announcement, menu teaser and a reminder story.",
        idea: { title, platform: "instagram", format: "post", caption: `${ev.label} at Kokoland — join us.` },
      });
    }
  }

  // 6. Evergreen ideas not already in the pipeline
  for (const e of EVERGREEN) {
    if (opts.posts.some((p) => p.title === e.title)) continue;
    out.push({ id: `ever-${e.key}`, tone: "neutral", title: e.title, detail: "A steady, low-effort idea for a small restaurant feed.", idea: { title: e.title, platform: e.platform, format: e.format, caption: e.caption } });
  }
  return out;
}

const labelOf = (p: SocialPlatform) => ({ instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", google: "Google Business" })[p];
