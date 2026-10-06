"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { getSiteStats, type Ranked } from "@/lib/api/traffic";
import { cn } from "@/lib/utils";

const RANGES = [7, 30, 90] as const;
const eur = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(n);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

const ORDER_TYPE: Record<string, string> = { takeaway: "Takeaway", dine_in: "Dine-in pre-order", delivery: "Delivery", table: "Table QR" };

export default function Traffic() {
  const { org } = useOrg();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useQuery({
    queryKey: ["org", org?.id, "site_stats", days],
    queryFn: () => getSiteStats(org!.slug, days),
    enabled: !!org,
    staleTime: 60_000,
  });
  const s = q.data;

  const visits = s?.funnel.page_view ?? 0;
  const orders = s?.totals.purchase ?? 0;
  const steps = [
    { label: "Visited the site", n: visits },
    { label: "Added a dish", n: s?.funnel.add_to_cart ?? 0 },
    { label: "Started checkout", n: s?.funnel.begin_checkout ?? 0 },
    { label: "Placed an order", n: (s?.funnel.purchase ?? 0) + (s?.funnel.begin_payment ?? 0) },
  ];
  const maxDay = Math.max(1, ...(s?.daily ?? []).map((d) => d.visits));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-zinc-400">
          How people use your website. Counted anonymously and without cookies, so every visitor is included. No IP addresses or personal data are stored.
        </p>
        <div className="flex gap-1 rounded-lg border border-line p-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={cn("cursor-pointer rounded-md px-3 py-1 text-sm", days === r ? "bg-brand-500/15 text-brand-300" : "text-zinc-400 hover:text-white")}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <Card className="p-6 text-sm text-zinc-500">Loading…</Card>}
      {q.error && (
        <Card className="p-6 text-sm text-rose-soft">
          Could not load the numbers. Has migration 0081 been applied, and are you an owner, admin, partner or manager?
        </Card>
      )}

      {s && !q.error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { l: "Visits", v: String(visits) },
              { l: "Page views", v: String(s.totals.page_view ?? 0) },
              { l: "Orders", v: String(orders) },
              { l: "Order value", v: eur(s.revenue) },
              { l: "Visit → order", v: pct(orders, visits) },
            ].map((k) => (
              <Card key={k.l} className="p-4">
                <p className="text-xs text-zinc-500">{k.l}</p>
                <p className="mt-1 font-display text-2xl font-bold text-white">{k.v}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 font-semibold text-white">From visit to order</h3>
              <div className="space-y-3">
                {steps.map((st) => (
                  <div key={st.label}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-zinc-300">{st.label}</span>
                      <span className="text-zinc-400">{st.n} <span className="text-zinc-600">· {pct(st.n, visits)}</span></span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-accent-400" style={{ width: `${visits ? Math.round((st.n / visits) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-zinc-500">A visit is one page load: a visitor who reloads counts again. Orders include pay-at-restaurant and pay-online.</p>
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 font-semibold text-white">Visits per day</h3>
              {s.daily.length === 0 ? (
                <p className="text-sm text-zinc-500">No visits recorded yet.</p>
              ) : (
                <div className="flex h-36 items-end gap-[3px]" role="img" aria-label="Visits per day">
                  {s.daily.map((d) => (
                    <div key={d.day} className="group relative flex-1" title={`${d.day}: ${d.visits} visits, ${d.orders} orders`}>
                      <div className="w-full rounded-t bg-brand-400/70 transition-colors group-hover:bg-brand-300" style={{ height: `${Math.max(3, Math.round((d.visits / maxDay) * 100))}%` }} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <List title="Most viewed pages" rows={s.top_pages} />
            <List title="Dishes added to carts" rows={s.top_dishes} />
            <List title="Where visitors come from" rows={s.sources} note="Visits" />
            <List title="Devices" rows={s.devices} note="Visits" />
            <List title="Table QR scans" rows={s.tables} fmt={(l) => `Table ${l}`} />
            <List title="Order types" rows={s.order_types} fmt={(l) => ORDER_TYPE[l] ?? l} />
            <List title="Clicks to delivery apps" rows={s.partners} />
          </div>
        </>
      )}
    </div>
  );
}

function List({ title, rows, fmt, note }: { title: string; rows: Ranked[]; fmt?: (l: string) => string; note?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold text-white">{title}</h3>
        {note && <span className="text-[11px] text-zinc-500">{note}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="relative overflow-hidden rounded-md">
              <div className="absolute inset-y-0 left-0 bg-brand-400/10" style={{ width: `${(r.n / max) * 100}%` }} />
              <div className="relative flex justify-between gap-3 px-2 py-1 text-sm">
                <span className="truncate text-zinc-200">{fmt ? fmt(r.label) : r.label}</span>
                <span className="shrink-0 text-zinc-400">{r.n}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
