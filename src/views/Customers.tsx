"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Heart, Users, Repeat, Gift, Plus } from "lucide-react";
import {
  Card, SectionTitle, StatCard, Badge, Button, Modal, Input, Field, Table, ProgressBar,
  EmptyState, PageSkeleton,
} from "@/components/ui";
import { useCustomers, useOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addCustomer } from "@/lib/api/people";
import { toast } from "@/lib/toast";
import { fmtNumber } from "@/lib/utils";

const tierTone: Record<string, "violet" | "amber" | "cyan" | "neutral"> = {
  Platinum: "violet",
  Gold: "amber",
  Silver: "cyan",
  Bronze: "neutral",
};

function AddCustomerForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const add = useMutation({
    mutationFn: () =>
      addCustomer(org!.id, {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        visits: 0,
        total_spend: 0,
        points: 0,
        tier: "Bronze",
        last_visit_at: null,
      }),
    onSuccess: () => {
      invalidate("customers");
      toast.success("Customer added", `${name.trim()} starts at Bronze`);
      onDone();
    },
    onError: (e) => toast.error("Could not add customer", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Guest name" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@email.com" />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0100" />
        </Field>
      </div>
      <Button className="w-full" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
        Add Customer
      </Button>
    </div>
  );
}

export default function Customers() {
  const fmt = useFmt();
  const customersQ = useCustomers();
  const ordersQ = useOrders();
  const [adding, setAdding] = useState(false);

  const customers = customersQ.data ?? [];
  const totalPoints = customers.reduce((s, c) => s + c.points, 0);
  const memberOrders = (ordersQ.data ?? []).filter((o) => o.customer_id).length;
  const repeatRate = (ordersQ.data ?? []).length > 0 ? Math.round((memberOrders / (ordersQ.data ?? []).length) * 100) : 0;

  if (customersQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Customers"
        subtitle="Your member directory. Visits, spend, tier and points track automatically from checkout."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add Customer
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Customers" value={String(customers.length)} hint="in your book" icon={Users} />
        <StatCard title="Attributed Orders" value={`${repeatRate}%`} hint="orders with a customer attached" icon={Repeat} />
        <StatCard
          title="Avg Customer Spend"
          value={customers.length ? fmt(customers.reduce((s, c) => s + c.total_spend, 0) / customers.length) : "-"}
          hint="lifetime average"
          icon={Heart}
        />
        <StatCard title="Points Outstanding" value={fmtNumber(totalPoints)} hint={`liability ${fmt(totalPoints / 20)}`} icon={Gift} />
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Directory</h3>
          <p className="text-xs text-zinc-500">Ranked by lifetime spend. Attach customers at POS checkout to track them.</p>
        </div>
        {customers.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="No customers yet"
            hint="Add guests here, then attach them to orders at checkout — visits, spend and tiers track automatically."
          />
        ) : (
          <Table headers={["Customer", "Tier", "Visits", "Lifetime Spend", "Points", "Last Visit"]}>
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{c.name}</p>
                  <p className="text-xs text-zinc-500">{c.email ?? c.phone ?? "-"}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={tierTone[c.tier] ?? "neutral"}>{c.tier}</Badge>
                </td>
                <td className="px-4 py-3 text-zinc-300">{c.visits}</td>
                <td className="px-4 py-3 font-medium text-zinc-200">{fmt(c.total_spend)}</td>
                <td className="px-4 py-3">
                  <p className="text-zinc-300">{fmtNumber(c.points)}</p>
                  <ProgressBar value={Math.min(100, (c.points / 5000) * 100)} tone="cyan" className="mt-1.5 w-24" />
                </td>
                <td className="px-4 py-3 text-zinc-400">
                  {c.last_visit_at ? new Date(c.last_visit_at).toLocaleDateString() : "never"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add Customer">
        <AddCustomerForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
