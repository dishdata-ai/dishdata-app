import { useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Plus,
  Calculator,
  Receipt,
  Landmark,
  Trash2,
  FileText,
  Upload,
  Camera,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ExternalLink,
  Loader2,
} from "lucide-react";
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
import { useExpenses, useOrders, useAcctInvoices, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { addExpense, deleteExpense } from "@/lib/api/people";
import { uploadBeleg, setInvoiceStatus, belegUrl } from "@/lib/api/accounting";
import { vatSummary, type AcctInvoice, type InvoiceBucket } from "@/lib/accounting/types";
import { ordersInRange } from "@/lib/calc";
import { toast } from "@/lib/toast";

/* ------------------------------------------------------------------ */
/* Belege (GoBD document vault + Vorsteuer compliance)                  */
/* ------------------------------------------------------------------ */

const BUCKET_META: Record<InvoiceBucket, { label: string; tone: "green" | "amber" | "rose" | "cyan" | "neutral" }> = {
  valid: { label: "Valid", tone: "green" },
  at_risk: { label: "At risk", tone: "amber" },
  blocked: { label: "Blocked", tone: "rose" },
  no_vat: { label: "No VAT", tone: "cyan" },
  review: { label: "Review", tone: "neutral" },
};

function BucketBadge({ bucket }: { bucket: InvoiceBucket }) {
  const m = BUCKET_META[bucket] ?? BUCKET_META.review;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

function InvoiceDetail({ invoice, onClose }: { invoice: AcctInvoice; onClose: () => void }) {
  const { org } = useOrg();
  const fmt = useFmt();
  const invalidate = useInvalidate();
  const [opening, setOpening] = useState(false);

  const review = useMutation({
    mutationFn: (status: "confirmed" | "excluded") => setInvoiceStatus(org!.id, invoice.id, status),
    onSuccess: (_, status) => {
      invalidate("acct_invoices");
      toast.success(status === "confirmed" ? "Invoice confirmed" : "Invoice excluded");
      onClose();
    },
    onError: (e) => toast.error("Update failed", e instanceof Error ? e.message : ""),
  });

  const openOriginal = async () => {
    if (!invoice.document?.storage_path) return;
    setOpening(true);
    try {
      const url = await belegUrl(invoice.document.storage_path);
      if (url) window.open(url, "_blank");
      else toast.error("Could not open original");
    } finally {
      setOpening(false);
    }
  };

  const flags = invoice.compliance_flags ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{invoice.vendor_name || "Unknown vendor"}</p>
          <p className="text-xs text-zinc-500">
            {invoice.invoice_no ? `Nr. ${invoice.invoice_no} · ` : ""}
            {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : "no date"}
          </p>
        </div>
        <BucketBadge bucket={invoice.bucket} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-white/[0.03] p-3">
          <p className="text-xs text-zinc-500">Net</p>
          <p className="font-medium text-zinc-200">{fmt(Number(invoice.total_net), 2)}</p>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-3">
          <p className="text-xs text-zinc-500">VAT</p>
          <p className="font-medium text-zinc-200">{fmt(Number(invoice.total_vat), 2)}</p>
        </div>
        <div className="rounded-lg bg-white/[0.03] p-3">
          <p className="text-xs text-zinc-500">Gross</p>
          <p className="font-medium text-white">{fmt(Number(invoice.gross), 2)}</p>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Compliance checks</p>
          {flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] p-2.5 text-sm">
              {f.severity === "block" ? (
                <ShieldX className="mt-0.5 h-4 w-4 shrink-0 text-rose-soft" />
              ) : f.severity === "warn" ? (
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-soft" />
              ) : (
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              )}
              <p className="text-zinc-300">{f.message}</p>
            </div>
          ))}
        </div>
      )}

      {invoice.notes && <p className="text-sm text-zinc-400">{invoice.notes}</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        {invoice.document?.storage_path && (
          <Button variant="ghost" onClick={openOriginal} disabled={opening}>
            <ExternalLink className="h-4 w-4" /> Original Beleg
          </Button>
        )}
        {invoice.status !== "confirmed" && (
          <Button onClick={() => review.mutate("confirmed")} disabled={review.isPending}>
            <ShieldCheck className="h-4 w-4" /> Confirm
          </Button>
        )}
        {invoice.status !== "excluded" && (
          <Button variant="ghost" onClick={() => review.mutate("excluded")} disabled={review.isPending}>
            Exclude
          </Button>
        )}
      </div>
    </div>
  );
}

function BelegeTab() {
  const { org } = useOrg();
  const fmt = useFmt();
  const invoicesQ = useAcctInvoices();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0); // count of in-flight uploads
  const [selected, setSelected] = useState<AcctInvoice | null>(null);
  const [bucketFilter, setBucketFilter] = useState<string>("all");

  const invoices = (invoicesQ.data ?? []) as AcctInvoice[];
  const sums = useMemo(() => vatSummary(invoices), [invoices]);
  const needsReview = invoices.filter((i) => i.status === "needs_review").length;

  const handleFiles = async (files: FileList | null) => {
    if (!files || !org) return;
    const list = Array.from(files);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const inv = await uploadBeleg(org.id, file, { fiscalYear: new Date().getFullYear() });
        invalidate("acct_invoices", "acct_documents");
        const blocked = inv.bucket === "blocked";
        (blocked ? toast.error : toast.success)(
          `${inv.vendor_name || file.name} — ${BUCKET_META[inv.bucket]?.label ?? inv.bucket}`,
          `VAT ${Number(inv.total_vat).toFixed(2)} € · ${inv.compliance_flags?.length ?? 0} checks`,
        );
      } catch (e) {
        toast.error(`Upload failed: ${file.name}`, e instanceof Error ? e.message : "");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const shown = bucketFilter === "all" ? invoices : invoices.filter((i) => i.bucket === bucketFilter);

  if (invoicesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Vorsteuer valid" value={fmt(sums.valid, 2)} hint="deductible input VAT" icon={ShieldCheck} />
        <StatCard title="At risk" value={fmt(sums.at_risk, 2)} hint="§14 recipient missing" icon={ShieldAlert} />
        <StatCard title="Blocked" value={fmt(sums.blocked, 2)} hint="wrong recipient / §19 defect" icon={ShieldX} />
        <StatCard title="Needs review" value={String(needsReview)} hint="documents awaiting confirmation" icon={FileText} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">Belege</h3>
            <p className="text-xs text-zinc-500">
              Originals stored immutably (GoBD, §147 AO) — extraction and §14/§19/§33 checks run automatically.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)} className="w-32">
              <option value="all">All buckets</option>
              {Object.entries(BUCKET_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Button variant="ghost" onClick={() => cameraRef.current?.click()} disabled={uploading > 0}>
              <Camera className="h-4 w-4" /> Photo
            </Button>
            <Button onClick={() => fileRef.current?.click()} disabled={uploading > 0}>
              {uploading > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading > 0 ? `Extracting ${uploading}…` : "Upload Beleg"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={invoices.length === 0 ? "No Belege yet" : "Nothing in this bucket"}
            hint="Upload supplier invoices, Kassenbons or photos — every document is checked against §14 UStG, §33 UStDV and §19 rules before its VAT counts."
            action={
              invoices.length === 0 ? (
                <Button onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Upload Beleg
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table headers={["Date", "Vendor", "Gross", "VAT", "Bucket", "Status"]}>
            {shown.map((inv) => (
              <tr
                key={inv.id}
                className="cursor-pointer hover:bg-white/[0.02]"
                onClick={() => setSelected(inv)}
              >
                <td className="px-4 py-3 text-zinc-400">
                  {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{inv.vendor_name || "Unknown"}</p>
                  <p className="text-xs text-zinc-500">
                    {inv.invoice_no ? `Nr. ${inv.invoice_no}` : inv.category}
                    {(inv.compliance_flags?.length ?? 0) > 0 && ` · ${inv.compliance_flags.length} flags`}
                  </p>
                </td>
                <td className="px-4 py-3 font-medium text-zinc-200">{fmt(Number(inv.gross), 2)}</td>
                <td className="px-4 py-3 text-zinc-400">{fmt(Number(inv.total_vat), 2)}</td>
                <td className="px-4 py-3">
                  <BucketBadge bucket={inv.bucket} />
                </td>
                <td className="px-4 py-3">
                  <Badge tone={inv.status === "confirmed" ? "green" : inv.status === "excluded" ? "rose" : "neutral"}>
                    {inv.status === "needs_review" ? "review" : inv.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Beleg detail">
        {selected && <InvoiceDetail invoice={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy quick expenses (manual entries, no document)                  */
/* ------------------------------------------------------------------ */

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

function ExpensesTab() {
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Expenses (30d)" value={fmt(expenses30)} hint={`${expenses.length} entries total`} icon={Receipt} />
        <StatCard title="Sales Tax Collected" value={fmt(taxes.collected, 2)} hint="from orders, 30 days" icon={Calculator} />
        <StatCard title="Input Tax Paid" value={fmt(taxes.paid, 2)} hint="on expenses, 30 days" icon={FileText} />
        <StatCard title="Net Tax Owed" value={fmt(taxes.net, 2)} hint="collected − paid" icon={Landmark} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h3 className="font-semibold text-white">Expense Ledger</h3>
            <p className="text-xs text-zinc-500">Manual entries without a stored document</p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Record Expense
          </Button>
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

/* ------------------------------------------------------------------ */

export default function Accounting() {
  const [tab, setTab] = useState<"belege" | "expenses">("belege");

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Accounting"
        subtitle="GoBD-compliant Beleg vault with automated German VAT compliance checks."
      />

      <div className="flex gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/10 w-fit">
        {(
          [
            ["belege", "Belege & Vorsteuer"],
            ["expenses", "Quick Expenses"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              tab === key ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "belege" ? <BelegeTab /> : <ExpensesTab />}
    </div>
  );
}
