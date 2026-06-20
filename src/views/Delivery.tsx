import { useMemo } from "react";
import { Bike, MapPin, ArrowRight, PackageCheck } from "lucide-react";
import { Card, SectionTitle, Badge, Select, EmptyState, PageSkeleton, StatCard } from "@/components/ui";
import { useDeliveries, useOrders, useEmployees, useInvalidate } from "@/lib/hooks/data";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { updateDelivery, DELIVERY_FLOW } from "@/lib/api/service";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Delivery, DeliveryStatus } from "@/lib/api/database.types";

const lanes: { status: DeliveryStatus; title: string; tone: string }[] = [
  { status: "pending", title: "Pending", tone: "#fbbf24" },
  { status: "assigned", title: "Assigned", tone: "#22d3ee" },
  { status: "picked_up", title: "On the Way", tone: "#a78bfa" },
  { status: "delivered", title: "Delivered", tone: "#34d399" },
];

export default function DeliveryPage() {
  const { org } = useOrg();
  const fmt = useFmt();
  const deliveriesQ = useDeliveries();
  const ordersQ = useOrders();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  useRealtimeInvalidate("deliveries", ["deliveries"]);

  const deliveries = deliveriesQ.data ?? [];
  const employees = employeesQ.data ?? [];
  const orders = ordersQ.data ?? [];

  const today = useMemo(() => {
    const key = new Date().toISOString().slice(0, 10);
    return deliveries.filter((d) => d.created_at.slice(0, 10) === key);
  }, [deliveries]);

  const active = deliveries.filter((d) => d.status !== "delivered" && d.status !== "failed");

  const advance = async (d: Delivery) => {
    const next = DELIVERY_FLOW[Math.min(DELIVERY_FLOW.indexOf(d.status) + 1, DELIVERY_FLOW.length - 1)];
    try {
      await updateDelivery(org!.id, d.id, { status: next });
      invalidate("deliveries");
      if (next === "delivered") toast.success("Delivered", "Nice work 🚴");
    } catch (e) {
      toast.error("Could not update delivery", e instanceof Error ? e.message : "");
    }
  };

  const assign = async (d: Delivery, employeeId: string) => {
    try {
      await updateDelivery(org!.id, d.id, {
        courier_employee_id: employeeId || null,
        status: employeeId && d.status === "pending" ? "assigned" : d.status,
      });
      invalidate("deliveries");
    } catch (e) {
      toast.error("Could not assign courier", e instanceof Error ? e.message : "");
    }
  };

  if (deliveriesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Delivery"
        subtitle="Delivery orders from POS land here — assign a courier and track the run."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Active Runs" value={String(active.length)} hint="in progress" icon={Bike} />
        <StatCard
          title="Delivered Today"
          value={String(today.filter((d) => d.status === "delivered").length)}
          hint={`of ${today.length} total`}
          icon={PackageCheck}
        />
        <StatCard
          title="Today's Delivery Revenue"
          value={fmt(
            today.reduce((s, d) => {
              const o = orders.find((x) => x.id === d.order_id);
              return s + (o?.total ?? 0);
            }, 0),
          )}
          hint="from delivery orders"
          icon={MapPin}
        />
      </div>

      {deliveries.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bike}
            title="No deliveries yet"
            hint='Ring up an order with type "Delivery" in the POS — it appears here automatically.'
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {lanes.map((lane) => {
            const items = deliveries
              .filter((d) => d.status === lane.status)
              .slice(0, lane.status === "delivered" ? 6 : 50);
            return (
              <div key={lane.status} className="space-y-3">
                <div className="flex items-center gap-2 px-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: lane.tone }} />
                  <h3 className="font-semibold text-white">{lane.title}</h3>
                  <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-xs font-bold text-zinc-400">
                    {items.length}
                  </span>
                </div>
                {items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line p-5 text-center text-xs text-zinc-600">
                    Empty
                  </div>
                ) : (
                  items.map((d) => {
                    const order = orders.find((o) => o.id === d.order_id);
                    const courier = employees.find((e) => e.id === d.courier_employee_id);
                    return (
                      <Card key={d.id} className="animate-rise p-4">
                        <div className="flex items-center justify-between">
                          <p className="font-display text-sm font-bold text-white">
                            {order?.order_number ?? "Order"}
                          </p>
                          {order && <span className="text-sm font-semibold text-brand-300">{fmt(order.total, 2)}</span>}
                        </div>
                        {order && (
                          <p className="mt-1 truncate text-xs text-zinc-500">
                            {order.items.map((l) => `${l.qty}× ${l.name}`).join(", ")}
                          </p>
                        )}
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-400">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-accent-400" />
                          {d.address || "No address on file"}
                        </p>
                        {d.status !== "delivered" && (
                          <div className="mt-3 space-y-2">
                            <Select
                              value={d.courier_employee_id ?? ""}
                              onChange={(e) => assign(d, e.target.value)}
                              className="py-1.5 text-xs"
                            >
                              <option value="">Assign courier…</option>
                              {employees.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </Select>
                            <button
                              onClick={() => advance(d)}
                              className={cn(
                                "inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-semibold transition-all",
                                "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950 hover:brightness-110",
                              )}
                            >
                              {d.status === "pending" ? "Mark assigned" : d.status === "assigned" ? "Picked up" : "Delivered"}
                              <ArrowRight className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                        {courier && d.status === "delivered" && (
                          <Badge tone="green" className="mt-2">by {courier.name}</Badge>
                        )}
                      </Card>
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
