"use client";

import Link from "next/link";
import { ArrowRight, UtensilsCrossed } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { useKitchenOps } from "@/views/kitchenops/useKitchenOps";
import { Counter, StatusPill } from "@/views/kitchenops/shared";
import { useOrg } from "@/lib/hooks/useOrg";
import { cn } from "@/lib/utils";

/** Bain-marie portions at a glance on the Kitchen board; the full plan lives in Kitchen Ops. */
export default function BainMarie() {
  const { moduleIds } = useOrg();
  const k = useKitchenOps(1);
  const tiles = k.rows.filter((r) => r.dish.bain_marie === "yes");
  if (k.loading || tiles.length === 0) return null;
  const low = tiles.filter((r) => r.status === "urgent" || r.status === "soon").length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <UtensilsCrossed className="h-4 w-4 text-brand-300" /> Bain-marie
          {low > 0 ? <Badge tone="rose">{low} need attention</Badge> : <Badge tone="green">all stocked</Badge>}
        </div>
        {moduleIds.has("kitchenops") && (
          <Link href="/kitchen?view=ops" className="inline-flex items-center gap-1 text-xs text-accent-400 hover:underline">
            Prep plan &amp; forecast <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((r) => (
          <div
            key={r.dish.id}
            className={cn(
              "rounded-xl border p-3",
              r.status === "urgent" ? "border-rose-soft/60 bg-rose-soft/10" : r.status === "soon" ? "border-amber-soft/40 bg-amber-soft/5" : "border-line bg-white/[0.02]",
            )}
          >
            <p className="text-sm font-semibold text-white">{r.dish.dish}</p>
            <div className="mt-2 flex items-center justify-between">
              <Counter value={r.hot} onChange={(d) => k.adjust(r.dish, "hot_portions", d)} label={r.dish.dish} />
            </div>
            <div className="mt-2"><StatusPill status={r.status} /></div>
            {(r.status === "urgent" || r.status === "soon") && <p className="mt-1 text-[11px] text-zinc-400">{r.action}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
