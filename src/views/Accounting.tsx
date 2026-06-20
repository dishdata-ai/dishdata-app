import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus, Calculator, Receipt, Landmark, Trash2, FileText } from "lucide-react";
import {
  Card,
  SectionTitle,
  StatCard,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  Table,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { useExpenses, useOrders, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addExpense, deleteExpense } from "@/lib/api/people";
import { ordersInRange } from "@/lib/calc";
import { toast } from "@/lib/toast";

const CATEGORIES = ["Food & Beverage", "Rent", "Utilities", "Marketing", "Maintenance", "Supplies", "Insurance", "Other"];

function AddExpenseForm({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "Food & Beverage",
    vendor: "",
    amount: "",
    tax: "",
    note: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const add = useMutation({
    mutationFn: () =>
      addExpense(org!.id, {
        date: form.date,
        category: form.category,
        vendor_name: form.vendor.trim(),
        amount: +form.amount,
        tax_amount: +form.tax || 0,
        receipt_url: null,
        note: form.note.trim() || null,
      }),
    onSuccess: () => {
      invalidate("expenses");
      toast.success("Expense recorded", `${form.vendor.trim()} — ${form.amount}`);
      onDone();
    },
    onError: (e) => toast.error("Could not record expense", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={form.date} onChange={set("date")} />
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor / payee">
          <Input value={form.vendor} onChange={set("vendor")} placeholder="Who was paid" />
        </Field>
        <Field label="Amount">
          <Input type="number" min="0" step="0.01" value={form.amount} onChange={set("amount")} placeholder="0.00" />
        </Field>
        <Field label="Tax portion (optional)">
          <Input type="number" min="0" step="0.01" value={form.tax} onChange={set("tax")} placeholder="0.00" />
        </Field>
        <Field label="Note (optional)">
          <Input value={form.note} onChange={set("note")} placeholder="Invoice #, detail…" />
        </Field>
      </div>
      <Button className="w-full" disabled={!(+form.amount > 0) || !form.vendor.trim() || add.isPending} onClick={() => add.mutate()}>
        Record Expense
      </Button>
    </div>
  );
}

export default function Accounting() {
  const { org, isManager } = useOrg();
  const fmt = useFmt();
  const expensesQ = useExpenses();
  const ordersQ = useOrders();
  const invalidate = useInvalidate();
  const [adding, setAdding] = useState(false);

  const expenses = expensesQ.data ?? [];

  const taxes = useMemo(() => {
    const orders30 = ordersInRange(ordersQ.data ?? [], 29).filter(
      (o) => o.status !== "void" && o.status !== "refunded",
    );
    const collected = orders30.reduce((s, o) => s + o.tax, 0);
    const cutoff = Date.now() - 30 * 86400000;
    const paid = expenses
      .filter((e) => new Date(e.date).getTime() > cutoff)
      .reduce((s, e) => s + e.tax_amount, 0);
    return { collected, paid, net: collected - paid };
  }, [ordersQ.data, expenses]);

  const expenses30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    return expenses.filter((e) => new Date(e.date).getTime() > cutoff).reduce((s, e) => s + e.amount, 0);
  }, [expenses]);

  if (expensesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Accounting"
        subtitle="Expense ledger and tax position — sales tax is computed from real orders."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Record Expense
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Expenses (30d)" value={fmt(expenses30)} hint={`${expenses.length} entries total`} icon={Receipt} />
        <StatCard title="Sales Tax Collected" value={fmt(taxes.collected, 2)} hint="from orders, 30 days" icon={Calculator} />
        <StatCard title="Input Tax Paid" value={fmt(taxes.paid, 2)} hint="on expenses, 30 days" icon={FileText} />
        <StatCard title="Net Tax Owed" value={fmt(taxes.net, 2)} hint="collected − paid" icon={Landmark} />
      </div>

      <Card>
        <div className="border-b border-line p-4">
          <h3 className="font-semibold text-white">Expense Ledger</h3>
          <p className="text-xs text-zinc-500">Most recent first</p>
        </div>
        {expenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses recorded"
            hint="Track rent, utilities, supplies and purchases to complete your P&L."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Record Expense
              </Button>
            }
          />
        ) : (
          <Table headers={["Date", "Vendor", "Category", "Amount", "Tax", ""]}>
            {expenses.map((e) => (
              <tr key={e.id} className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-zinc-400">{new Date(e.date).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{e.vendor_name}</p>
                  {e.note && <p className="text-xs text-zinc-500">{e.note}</p>}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">{e.category}</Badge>
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">{fmt(e.amount, 2)}</td>
                <td className="px-4 py-3 text-zinc-400">{e.tax_amount > 0 ? fmt(e.tax_amount, 2) : "—"}</td>
                <td className="px-4 py-3">
                  {isManager && (
                    <button
                      onClick={async () => {
                        await deleteExpense(org!.id, e.id);
                        invalidate("expenses");
                        toast.info("Expense deleted");
                      }}
                      className="cursor-pointer rounded-lg p-1.5 text-zinc-500 hover:bg-rose-soft/10 hover:text-rose-soft"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Record Expense">
        <AddExpenseForm onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
