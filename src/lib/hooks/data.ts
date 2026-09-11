// TanStack Query hooks for all org-scoped domains.
// Query keys: ["org", orgId, <domain>] — useInvalidate() bulk-invalidates after mutations.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrg } from "@/lib/hooks/useOrg";
import { listRecipes } from "@/lib/api/recipes";
import { listInventory, listTransactions } from "@/lib/api/inventory";
import { listLocations } from "@/lib/api/locations";
import { listMaintenance } from "@/lib/api/assets";
import { listVendors, listPurchaseOrders } from "@/lib/api/procurement";
import { listSupplierPrices } from "@/lib/api/pricing";
import { listOrders, listPayments } from "@/lib/api/orders";
import { listEmployees, listCustomers, listExpenses } from "@/lib/api/people";
import { listTables, listReservations, listDeliveries } from "@/lib/api/service";
import { getOpenTill, listTillSessions } from "@/lib/api/till";
import { listTimeEntries } from "@/lib/api/timeclock";
import { listAvailability } from "@/lib/api/availability";
import { listTasks } from "@/lib/api/tasks";
import { listMembers } from "@/lib/api/team";
import { listPartnerProfiles, listKudos } from "@/lib/api/partners";
import { listAcctInvoices, listAcctDocuments } from "@/lib/api/accounting";
import { listPayProfiles, listPayrollRuns } from "@/lib/api/payroll";
import { listEventMenus } from "@/lib/api/eventMenus";
import { listChannels, listChannelOrders } from "@/lib/api/channels";
import { listPreorderEvents, listPreorderOrders } from "@/lib/api/preorders";

function useOrgQuery<T>(domain: string, fn: (orgId: string) => Promise<T>) {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["org", org?.id, domain],
    queryFn: () => fn(org!.id),
    enabled: !!org,
  });
}

export const useRecipes = () => useOrgQuery("recipes", listRecipes);
export const useEventMenus = () => useOrgQuery("event_menus", listEventMenus);
export const usePreorderEvents = () => useOrgQuery("preorder_events", listPreorderEvents);
export const useInventory = () => useOrgQuery("inventory", listInventory);
export const useInventoryTransactions = () => useOrgQuery("inventory_tx", (id) => listTransactions(id));
export const useLocations = () => useOrgQuery("locations", listLocations);
export const useMaintenance = () => useOrgQuery("maintenance", listMaintenance);
export const useVendors = () => useOrgQuery("vendors", listVendors);
export const usePurchaseOrders = () => useOrgQuery("purchase_orders", listPurchaseOrders);
export const useSupplierPrices = () => useOrgQuery("supplier_prices", listSupplierPrices);
export const useOrders = () => useOrgQuery("orders", (id) => listOrders(id));
export const usePayments = () => useOrgQuery("payments", (id) => listPayments(id));
export const useEmployees = () => useOrgQuery("employees", listEmployees);
export const useCustomers = () => useOrgQuery("customers", listCustomers);
export const useExpenses = () => useOrgQuery("expenses", listExpenses);
export const useTables = () => useOrgQuery("restaurant_tables", listTables);
export const useReservations = () => useOrgQuery("reservations", listReservations);
export const useDeliveries = () => useOrgQuery("deliveries", listDeliveries);
export const useOpenTill = () => useOrgQuery("till_open", getOpenTill);
export const useTillSessions = () => useOrgQuery("till_sessions", (id) => listTillSessions(id));
export const useTimeEntries = () => useOrgQuery("time_entries", (id) => listTimeEntries(id));
export const useAvailability = () => useOrgQuery("staff_availability", listAvailability);
export const useTasks = () => useOrgQuery("tasks", listTasks);
export const useMembers = () => useOrgQuery("members", listMembers);
export const usePartnerProfiles = () => useOrgQuery("partner_profiles", listPartnerProfiles);
export const useKudos = () => useOrgQuery("kudos", listKudos);
export const useAcctInvoices = () => useOrgQuery("acct_invoices", listAcctInvoices);
export const useAcctDocuments = () => useOrgQuery("acct_documents", listAcctDocuments);
export const usePayProfiles = () => useOrgQuery("pay_profiles", listPayProfiles);
export const usePayrollRuns = () => useOrgQuery("payroll_runs", listPayrollRuns);
export const useChannels = () => useOrgQuery("channels", listChannels);
export const useChannelOrders = () => useOrgQuery("channel_orders", (id) => listChannelOrders(id));

/** Invalidate one or more org-scoped domains after a mutation. */
export function useInvalidate() {
  const { org } = useOrg();
  const qc = useQueryClient();
  return (...domains: string[]) => {
    for (const d of domains) {
      qc.invalidateQueries({ queryKey: ["org", org?.id, d] });
    }
  };
}

/**
 * Orders for one event. Keyed under the same "preorder_orders" domain as the
 * other hooks, so `useInvalidate()("preorder_orders")` still matches by prefix.
 */
export function usePreorderOrders(eventId: string | undefined) {
  const { org } = useOrg();
  return useQuery({
    queryKey: ["org", org?.id, "preorder_orders", eventId],
    queryFn: () => listPreorderOrders(org!.id, eventId!),
    enabled: !!org && !!eventId,
  });
}
