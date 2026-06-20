import { useMemo } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { Star, HelpCircle, Workflow, ThumbsDown, SquareMenu } from "lucide-react";
import { Card, SectionTitle, Badge, Table, EmptyState, PageSkeleton } from "@/components/ui";
import { useRecipes, useOrders } from "@/lib/hooks/data";
import { useFmt } from "@/lib/hooks/useFmt";
import { recipeCost, marginPct, popularityScores, ordersInRange } from "@/lib/calc";
import { fmtPct } from "@/lib/utils";

type Quadrant = "Star" | "Plowhorse" | "Puzzle" | "Dog";

const quadrantMeta: Record<
  Quadrant,
  { tone: "green" | "cyan" | "violet" | "rose"; color: string; advice: string; icon: typeof Star }
> = {
  Star: { tone: "green", color: "#34d399", advice: "Protect and promote — high margin, high popularity.", icon: Star },
  Plowhorse: { tone: "cyan", color: "#22d3ee", advice: "Popular but thin margin — re-cost or nudge price.", icon: Workflow },
  Puzzle: { tone: "violet", color: "#a78bfa", advice: "Profitable but unloved — reposition or feature it.", icon: HelpCircle },
  Dog: { tone: "rose", color: "#fb7185", advice: "Low margin, low demand — candidate for removal.", icon: ThumbsDown },
};

const MARGIN_THRESHOLD = 65;
const POPULARITY_THRESHOLD = 45;

export default function MenuEngineering() {
  const fmt = useFmt();
  const recipesQ = useRecipes();
  const ordersQ = useOrders();

  const recipes = recipesQ.data ?? [];
  const recentOrders = useMemo(() => ordersInRange(ordersQ.data ?? [], 13), [ordersQ.data]);
  const popularity = useMemo(() => popularityScores(recipes, recentOrders), [recipes, recentOrders]);

  const items = useMemo(
    () =>
      recipes.map((r) => {
        const margin = marginPct(r);
        const pop = popularity.get(r.id) ?? 0;
        const quadrant: Quadrant =
          margin >= MARGIN_THRESHOLD && pop >= POPULARITY_THRESHOLD
            ? "Star"
            : margin < MARGIN_THRESHOLD && pop >= POPULARITY_THRESHOLD
              ? "Plowhorse"
              : margin >= MARGIN_THRESHOLD
                ? "Puzzle"
                : "Dog";
        return { ...r, margin, popularity: pop, quadrant, profit: r.price - recipeCost(r) };
      }),
    [recipes, popularity],
  );

  const counts = (Object.keys(quadrantMeta) as Quadrant[]).map((q) => ({
    q,
    n: items.filter((i) => i.quadrant === q).length,
  }));

  if (recipesQ.isLoading || ordersQ.isLoading) return <PageSkeleton />;

  if (recipes.length === 0) {
    return (
      <div className="space-y-6">
        <SectionTitle title="Menu Engineering" subtitle="Profitability vs popularity — where every dish sits." />
        <Card>
          <EmptyState icon={SquareMenu} title="No menu to analyze" hint="Add recipes and ring up some sales first." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Menu Engineering"
        subtitle="Popularity computed from the last 14 days of real sales."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {counts.map(({ q, n }) => {
          const meta = quadrantMeta[q];
          return (
            <Card key={q} className="p-5">
              <div className="flex items-center justify-between">
                <Badge tone={meta.tone}>
                  <meta.icon className="h-3 w-3" /> {q}s
                </Badge>
                <span className="font-display text-2xl font-bold text-white">{n}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">{meta.advice}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-5">
        <h3 className="font-semibold text-white">Engineering Matrix</h3>
        <p className="mb-4 text-xs text-zinc-500">
          X: popularity (relative sales) · Y: gross margin % · thresholds at {POPULARITY_THRESHOLD} / {MARGIN_THRESHOLD}%
        </p>
        <ResponsiveContainer width="100%" height={380}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#262a38" />
            <XAxis type="number" dataKey="popularity" name="Popularity" domain={[0, 100]} stroke="#71717a" fontSize={12} tickLine={false} />
            <YAxis type="number" dataKey="margin" name="Margin" domain={[30, 95]} stroke="#71717a" fontSize={12} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine x={POPULARITY_THRESHOLD} stroke="#52525b" strokeDasharray="6 4" />
            <ReferenceLine y={MARGIN_THRESHOLD} stroke="#52525b" strokeDasharray="6 4" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as (typeof items)[number] | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-xl border border-line bg-raised p-3 text-xs shadow-xl">
                    <p className="font-semibold text-white">
                      {p.emoji} {p.name}
                    </p>
                    <p className="mt-1 text-zinc-400">
                      Margin {fmtPct(p.margin, 0)} · Popularity {p.popularity}
                    </p>
                    <p className="mt-0.5 font-medium" style={{ color: quadrantMeta[p.quadrant].color }}>
                      {p.quadrant}
                    </p>
                  </div>
                );
              }}
            />
            <Scatter data={items}>
              {items.map((i) => (
                <Cell key={i.id} fill={quadrantMeta[i.quadrant].color} fillOpacity={0.9} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </Card>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">All Menu Items</h3>
        </div>
        <Table headers={["Item", "Price", "Cost", "Profit", "Margin", "Popularity", "Class"]}>
          {[...items]
            .sort((a, b) => b.profit * b.popularity - a.profit * a.popularity)
            .map((i) => (
              <tr key={i.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-medium text-white">
                  <span className="mr-2">{i.emoji}</span>
                  {i.name}
                </td>
                <td className="px-4 py-3 text-zinc-300">{fmt(i.price)}</td>
                <td className="px-4 py-3 text-zinc-400">{fmt(recipeCost(i), 2)}</td>
                <td className="px-4 py-3 font-medium text-zinc-200">{fmt(i.profit, 2)}</td>
                <td className="px-4 py-3 text-zinc-300">{fmtPct(i.margin, 0)}</td>
                <td className="px-4 py-3 text-zinc-300">{i.popularity}</td>
                <td className="px-4 py-3">
                  <Badge tone={quadrantMeta[i.quadrant].tone}>{i.quadrant}</Badge>
                </td>
              </tr>
            ))}
        </Table>
      </Card>
    </div>
  );
}
