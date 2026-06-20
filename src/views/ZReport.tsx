import { useMemo, useState } from "react";
import { Printer, ReceiptText, Banknote, CreditCard, Smartphone } from "lucide-react";
import { Card, SectionTitle, StatCard, Button, Input, EmptyState, PageSkeleton, Table } from "@/components/ui";
import { useOrders, usePayments } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import type { PaymentMethod } from "@/lib/api/database.types";

const methodMeta: Record<PaymentMethod, { label: string; icon: typeof Banknote }> = {
  cash: { label: "Cash", icon: Banknote },
  card: { label: "Card", icon: CreditCard },
  wallet: { label: "Wallet", icon: Smartphone },
  stripe: { label: "Stripe", icon: CreditCard },
};

export default function ZReport() {
  const { org } = useOrg();
  const fmt = useFmt();
  const ordersQ = useOrders();
  const paymentsQ = usePayments();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const report = useMemo(() => {
    const dayOrders = (ordersQ.data ?? []).filter((o) => o.created_at.slice(0, 10) === date);
    const valid = dayOrders.filter((o) => o.status !== "void" && o.status !== "refunded");
    const voids = dayOrders.length - valid.length;
    const orderIds = new Set(dayOrders.map((o) => o.id));
    const payments = (paymentsQ.data ?? []).filter((p) => orderIds.has(p.order_id));

    const byMethod = new Map<PaymentMethod, { count: number; amount: number; tips: number }>();
    for (const p of payments) {
      const b = byMethod.get(p.method) ?? { count: 0, amount: 0, tips: 0 };
      b.count += 1;
      b.amount += p.amount;
      b.tips += p.tip_amount;
      byMethod.set(p.method, b);
    }

    return {
      gross: valid.reduce((s, o) => s + o.total, 0),
      net: valid.reduce((s, o) => s + o.subtotal, 0),
      tax: valid.reduce((s, o) => s + o.tax, 0),
      tips: valid.reduce((s, o) => s + o.tip, 0),
      orders: valid.length,
      voids,
      unpaid: valid.filter((o) => o.status === "open"),
      byMethod,
      avg: valid.length ? valid.reduce((s, o) => s + o.total, 0) / valid.length : 0,
    };
  }, [ordersQ.data, paymentsQ.data, date]);

  if (ordersQ.isLoading) return <PageSkeleton />;

  const cashExpected = report.byMethod.get("cash")?.amount ?? 0;

  return (
    <div className="space-y-6 print:text-black">
      <SectionTitle
        title="Z-Report"
        subtitle="End-of-day close-out — takings, taxes, tips and drawer expectations."
        action={
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        }
      />

      {report.orders === 0 && report.voids === 0 ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title={`No activity on ${new Date(date).toLocaleDateString()}`}
            hint="Pick another date or ring up some orders."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Gross Takings" value={fmt(report.gross, 2)} hint={`${report.orders} orders`} icon={ReceiptText} />
            <StatCard title="Net Sales" value={fmt(report.net, 2)} hint="before tax & tips" icon={Banknote} />
            <StatCard title="Tax Collected" value={fmt(report.tax, 2)} hint="owed to the taxman" icon={CreditCard} />
            <StatCard title="Tips" value={fmt(report.tips, 2)} hint="owed to the team" icon={Smartphone} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="border-b border-line p-4">
                <h3 className="font-semibold text-white">Takings by Method</h3>
                <p className="text-xs text-zinc-500">Reconcile each against the terminal / drawer</p>
              </div>
              <Table headers={["Method", "Transactions", "Tips", "Amount"]}>
                {[...report.byMethod.entries()].map(([method, b]) => {
                  const meta = methodMeta[method];
                  return (
                    <tr key={method} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 font-medium text-white">
                        <meta.icon className="mr-2 inline h-4 w-4 text-zinc-400" />
                        {meta.label}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{b.count}</td>
                      <td className="px-4 py-3 text-zinc-400">{fmt(b.tips, 2)}</td>
                      <td className="px-4 py-3 font-semibold text-zinc-100">{fmt(b.amount, 2)}</td>
                    </tr>
                  );
                })}
              </Table>
              <div className="border-t border-line p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Expected cash in drawer</span>
                  <span className="font-display text-lg font-bold text-brand-300">{fmt(cashExpected, 2)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="mb-4 font-semibold text-white">Day Summary — {new Date(date).toLocaleDateString()}</h3>
              <div className="space-y-2 text-sm">
                {(
                  [
                    ["Completed orders", String(report.orders)],
                    ["Average ticket", fmt(report.avg, 2)],
                    ["Voids / refunds", String(report.voids)],
                    ["Unpaid (open) orders", String(report.unpaid.length)],
                    ["Net sales", fmt(report.net, 2)],
                    ["+ Sales tax", fmt(report.tax, 2)],
                    ["+ Tips", fmt(report.tips, 2)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between rounded-lg px-3 py-2 odd:bg-white/[0.02]">
                    <span className="text-zinc-400">{label}</span>
                    <span className="font-medium text-zinc-100">{value}</span>
                  </div>
                ))}
                <div className="flex justify-between rounded-lg bg-white/[0.05] px-3 py-2.5 font-semibold">
                  <span className="text-white">= Gross takings</span>
                  <span className="text-gradient font-display text-base">{fmt(report.gross, 2)}</span>
                </div>
              </div>
              {report.unpaid.length > 0 && (
                <p className="mt-3 rounded-xl border border-amber-soft/20 bg-amber-soft/5 p-3 text-xs text-amber-soft">
                  {report.unpaid.length} open order{report.unpaid.length > 1 ? "s" : ""} still unpaid:{" "}
                  {report.unpaid.map((o) => o.order_number).join(", ")} — settle before closing.
                </p>
              )}
              <p className="mt-4 text-xs text-zinc-600">
                {org?.name} · generated {new Date().toLocaleString()} · DishData Z-Report
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
