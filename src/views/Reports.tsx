import { useMemo, useState } from "react";
import { Download, FileBarChart } from "lucide-react";
import { Card, SectionTitle, Button, Table, EmptyState, PageSkeleton } from "@/components/ui";
import {
  useOrders,
  usePayments,
  useInventory,
  useRecipes,
  useTimeEntries,
  useEmployees,
} from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { downloadCsv } from "@/lib/csv";
import { ordersInRange, unitsSold, recipeCost } from "@/lib/calc";
import { workedSeconds } from "@/lib/api/timeclock";
import { cn } from "@/lib/utils";

type ReportId = "sales" | "items" | "payments" | "inventory" | "labor";
type Range = 7 | 30 | 90;

const REPORTS: { id: ReportId; name: string; blurb: string }[] = [
  { id: "sales", name: "Sales by Day", blurb: "Revenue, orders, tax and tips per day" },
  { id: "items", name: "Items Sold", blurb: "Units, revenue and profit per menu item" },
  { id: "payments", name: "Payments & Taxes", blurb: "Takings by method with tax breakdown" },
  { id: "inventory", name: "Inventory Valuation", blurb: "Current stock value by item" },
  { id: "labor", name: "Labor Hours", blurb: "Tracked hours and cost per employee" },
];

export default function Reports() {
  const { org } = useOrg();
  const fmt = useFmt();
  const [report, setReport] = useState<ReportId>("sales");
  const [range, setRange] = useState<Range>(30);

  const ordersQ = useOrders();
  const paymentsQ = usePayments();
  const inventoryQ = useInventory();
  const recipesQ = useRecipes();
  const entriesQ = useTimeEntries();
  const employeesQ = useEmployees();

  const data = useMemo((): { headers: string[]; rows: (string | number)[][] } => {
    const orders = ordersInRange(ordersQ.data ?? [], range - 1).filter(
      (o) => o.status !== "void" && o.status !== "refunded",
    );

    switch (report) {
      case "sales": {
        const byDay = new Map<string, { revenue: number; orders: number; tax: number; tips: number }>();
        for (const o of orders) {
          const day = o.created_at.slice(0, 10);
          const b = byDay.get(day) ?? { revenue: 0, orders: 0, tax: 0, tips: 0 };
          b.revenue += o.total;
          b.orders += 1;
          b.tax += o.tax;
          b.tips += o.tip;
          byDay.set(day, b);
        }
        return {
          headers: ["Date", "Orders", "Revenue", "Tax", "Tips", "Avg Ticket"],
          rows: [...byDay.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([day, b]) => [
              day,
              b.orders,
              b.revenue.toFixed(2),
              b.tax.toFixed(2),
              b.tips.toFixed(2),
              (b.revenue / b.orders).toFixed(2),
            ]),
        };
      }
      case "items": {
        const sold = unitsSold(orders);
        return {
          headers: ["Item", "Category", "Units Sold", "Revenue", "Plate Cost", "Profit"],
          rows: (recipesQ.data ?? [])
            .map((r) => {
              const units = sold.get(r.id) ?? 0;
              const cost = recipeCost(r);
              return [r.name, r.category, units, (units * r.price).toFixed(2), cost.toFixed(2), (units * (r.price - cost)).toFixed(2)] as (string | number)[];
            })
            .filter((row) => Number(row[2]) > 0)
            .sort((a, b) => Number(b[2]) - Number(a[2])),
        };
      }
      case "payments": {
        const cutoff = Date.now() - range * 86400000;
        const payments = (paymentsQ.data ?? []).filter((p) => new Date(p.created_at).getTime() > cutoff);
        const byMethod = new Map<string, { count: number; amount: number; tips: number }>();
        for (const p of payments) {
          const b = byMethod.get(p.method) ?? { count: 0, amount: 0, tips: 0 };
          b.count += 1;
          b.amount += p.amount;
          b.tips += p.tip_amount;
          byMethod.set(p.method, b);
        }
        const taxTotal = orders.reduce((s, o) => s + o.tax, 0);
        const rows = [...byMethod.entries()].map(
          ([method, b]) => [method, b.count, b.amount.toFixed(2), b.tips.toFixed(2)] as (string | number)[],
        );
        rows.push(["TOTAL TAX COLLECTED", "", taxTotal.toFixed(2), ""]);
        return { headers: ["Method", "Transactions", "Amount", "Tips"], rows };
      }
      case "inventory":
        return {
          headers: ["Item", "Category", "Stock", "Unit", "Unit Cost", "Value", "Par"],
          rows: (inventoryQ.data ?? [])
            .map(
              (i) =>
                [i.name, i.category, +i.stock.toFixed(2), i.unit, i.unit_cost.toFixed(2), (i.stock * i.unit_cost).toFixed(2), i.par_level] as (string | number)[],
            )
            .sort((a, b) => Number(b[5]) - Number(a[5])),
        };
      case "labor": {
        const cutoff = Date.now() - range * 86400000;
        const entries = (entriesQ.data ?? []).filter((e) => new Date(e.clock_in).getTime() > cutoff);
        const byEmp = new Map<string, { hours: number; shifts: number }>();
        for (const e of entries) {
          const b = byEmp.get(e.employee_id) ?? { hours: 0, shifts: 0 };
          b.hours += workedSeconds(e) / 3600;
          b.shifts += 1;
          byEmp.set(e.employee_id, b);
        }
        return {
          headers: ["Employee", "Role", "Shifts", "Hours", "Rate", "Labor Cost"],
          rows: (employeesQ.data ?? [])
            .filter((emp) => byEmp.has(emp.id))
            .map((emp) => {
              const b = byEmp.get(emp.id)!;
              return [emp.name, emp.role_title, b.shifts, b.hours.toFixed(1), emp.hourly_rate.toFixed(2), (b.hours * emp.hourly_rate).toFixed(2)] as (string | number)[];
            }),
        };
      }
    }
  }, [report, range, ordersQ.data, paymentsQ.data, inventoryQ.data, recipesQ.data, entriesQ.data, employeesQ.data]);

  const exportCsv = () => {
    const name = `dishdata-${report}-${range}d-${new Date().toISOString().slice(0, 10)}`;
    downloadCsv(name, data.headers, data.rows);
  };

  if (ordersQ.isLoading) return <PageSkeleton />;

  const meta = REPORTS.find((r) => r.id === report)!;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Reports"
        subtitle="Period reports computed from live data — export any of them as CSV."
        action={
          <Button onClick={exportCsv} disabled={data.rows.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {REPORTS.map((r) => (
            <button
              key={r.id}
              onClick={() => setReport(r.id)}
              className={cn(
                "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                report === r.id
                  ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                  : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              {r.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex rounded-xl border border-line bg-surface p-1">
          {([7, 30, 90] as Range[]).map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-all",
                range === d ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">{meta.name}</h3>
          <p className="text-xs text-zinc-500">
            {meta.blurb} · last {range} days · {fmt(0, 0).replace(/[\d.,\s]/g, "") || "$"} amounts in {org?.currency}
          </p>
        </div>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title="Nothing to report yet"
            hint="This report fills in as data accumulates in the selected period."
          />
        ) : (
          <Table headers={data.headers}>
            {data.rows.map((row, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                {row.map((cell, j) => (
                  <td key={j} className={cn("px-4 py-2.5", j === 0 ? "font-medium text-white" : "text-zinc-300")}>
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
