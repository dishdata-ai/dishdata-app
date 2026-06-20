import { useOrg } from "@/lib/hooks/useOrg";
import { currencyFormatter } from "@/lib/calc";

/** Currency formatter bound to the org's configured currency. */
export function useFmt() {
  const { org } = useOrg();
  return currencyFormatter(org?.currency ?? "USD");
}
