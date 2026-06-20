import { useQuery } from "@tanstack/react-query";
import { ScrollText, Plus, Pencil, Trash2 } from "lucide-react";
import { Card, SectionTitle, Badge, EmptyState, PageSkeleton, Table } from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { listAudit } from "@/lib/api/notifications";
import { cn } from "@/lib/utils";

const actionMeta: Record<string, { tone: "green" | "cyan" | "rose"; icon: typeof Plus }> = {
  INSERT: { tone: "green", icon: Plus },
  UPDATE: { tone: "cyan", icon: Pencil },
  DELETE: { tone: "rose", icon: Trash2 },
};

const tableLabels: Record<string, string> = {
  recipes: "Recipe",
  inventory_items: "Inventory",
  orders: "Order",
  expenses: "Expense",
  employees: "Employee",
  member_module_access: "Module access",
  purchase_orders: "Purchase order",
  orgs: "Settings",
};

export default function AuditLog() {
  const { org } = useOrg();
  const auditQ = useQuery({
    queryKey: ["org", org?.id, "audit"],
    queryFn: () => listAudit(org!.id),
    enabled: !!org,
  });

  if (auditQ.isLoading) return <PageSkeleton />;
  const entries = auditQ.data ?? [];

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Audit Log"
        subtitle="Who changed what, when — recorded automatically on key tables."
      />

      <Card>
        {entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries yet"
            hint="Changes to recipes, inventory, orders, expenses, team access and settings are recorded here."
          />
        ) : (
          <Table headers={["When", "Action", "Area", "Detail"]}>
            {entries.map((e) => {
              const meta = actionMeta[e.action] ?? actionMeta.UPDATE;
              const detail = e.detail as Record<string, unknown> | null;
              const name =
                (detail?.name as string) ??
                ((detail?.new as Record<string, unknown>)?.name as string) ??
                (detail?.order_number as string) ??
                ((detail?.new as Record<string, unknown>)?.order_number as string) ??
                e.row_id?.slice(0, 8) ??
                "—";
              return (
                <tr key={e.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3 text-zinc-400">
                    {new Date(e.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={meta.tone}>
                      <meta.icon className="h-3 w-3" /> {e.action.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 font-medium text-white">{tableLabels[e.table_name] ?? e.table_name}</td>
                  <td className={cn("max-w-xs truncate px-4 py-3 text-zinc-300")}>{String(name)}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
