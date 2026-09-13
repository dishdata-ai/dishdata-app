import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { computeTaxGroups, sumTax, type TaxGroup } from "@/lib/tax";
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle2,
  ShoppingBag,
  UtensilsCrossed,
  ChefHat,
  Receipt,
  Users,
  Clock,
  SplitSquareHorizontal,
} from "lucide-react";
import {
  Card,
  SectionTitle,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { useRecipes, useEventMenus, useCustomers, useTables, useOrders, useEmployees, useInvalidate } from "@/lib/hooks/data";
import { ReceiptButton, PrintReceiptButton } from "@/components/ReceiptButton";
import { useUi } from "@/lib/store";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { orderCategories } from "@/lib/category-order";
import { useFmt } from "@/lib/hooks/useFmt";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import {
  checkoutOrder,
  markOrderPaid,
  setKitchenStatus,
  getStaffDiscountUsage,
  getStaffMealUsage,
  type CheckoutResult,
} from "@/lib/api/orders";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Order, OrderType, PaymentMethod, Recipe } from "@/lib/api/database.types";
import { isSoldOut } from "@/lib/calc";

// Category pills are derived from the menu actually loaded (see `categories`
// below) rather than a fixed list — restaurants use their own taxonomies
// (e.g. Breakfast/Lunch/Dinner for an event), and a hardcoded list would hide
// those dishes behind "All".

type PaymentInput = { method: PaymentMethod; amount: number; tip_amount?: number; split_label?: string };
type BillLine = { name: string; qty: number; price: number; tax_rate?: number | null };

const methodMeta = [
  ["card", CreditCard, "Card"],
  ["cash", Banknote, "Cash"],
  ["wallet", Smartphone, "Wallet"],
] as [PaymentMethod, typeof CreditCard, string][];

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

// ---------------------------------------------------------------------------
// Pay modal — single payer, even split, or split by dish, each payer can use a
// different method. Returns the payments[] array plus the resolved tip amount.
// ---------------------------------------------------------------------------
function PayModal({
  open,
  onClose,
  lines,
  subtotal,
  taxGroups,
  initialTipPct,
  discountAmount,
  discountLabel,
  confirmLabel,
  pending,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  lines: BillLine[];
  subtotal: number;
  /** VAT already contained in the gross prices, split per rate (food vs drinks). */
  taxGroups: TaxGroup[];
  initialTipPct: number;
  /** Already-applied discount, for display only — `subtotal` is already net of it. */
  discountAmount?: number;
  discountLabel?: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (payments: PaymentInput[], tip: number) => void;
}) {
  const fmt = useFmt();
  const [tipPct, setTipPct] = useState(initialTipPct);
  const [mode, setMode] = useState<"single" | "even" | "item">("single");
  const [guests, setGuests] = useState(2);
  // assignments[lineIndex] = guest index (0-based) or "shared"
  const [assign, setAssign] = useState<Record<number, number | "shared">>({});
  const [methods, setMethods] = useState<PaymentMethod[]>(["card", "card", "card", "card", "card", "card"]);

  const tax = sumTax(taxGroups);
  const tip = +(subtotal * (tipPct / 100)).toFixed(2);
  const total = +(subtotal + tax + tip).toFixed(2);

  const setMethod = (i: number, m: PaymentMethod) =>
    setMethods((prev) => prev.map((x, idx) => (idx === i ? m : x)));

  // Per-payer breakdown for split modes.
  const payers = useMemo(() => {
    if (mode === "single") return [{ label: null as string | null, sub: subtotal, tax, tip, amount: total }];

    const n = guests;
    const subs = Array(n).fill(0) as number[];
    lines.forEach((l, i) => {
      const lineTotal = l.price * l.qty;
      const a = mode === "even" ? "shared" : assign[i] ?? "shared";
      if (a === "shared") for (let g = 0; g < n; g++) subs[g] += lineTotal / n;
      else subs[Math.min(a, n - 1)] += lineTotal;
    });

    const rows = subs.map((s) => {
      const ratio = subtotal > 0 ? s / subtotal : 1 / n;
      return {
        sub: +s.toFixed(2),
        tax: +(tax * ratio).toFixed(2),
        tip: +(tip * ratio).toFixed(2),
        amount: +((s + tax * ratio + tip * ratio)).toFixed(2),
      };
    });
    // Absorb rounding drift into the first payer so the sum is exact.
    const drift = +(total - rows.reduce((acc, r) => acc + r.amount, 0)).toFixed(2);
    if (rows[0]) rows[0].amount = +(rows[0].amount + drift).toFixed(2);
    return rows.map((r, i) => ({ label: `Guest ${i + 1}`, ...r }));
  }, [mode, guests, assign, lines, subtotal, tax, tip, total]);

  const confirm = () => {
    const payments: PaymentInput[] = payers.map((p, i) => ({
      method: mode === "single" ? methods[0] : methods[i],
      amount: p.amount,
      tip_amount: p.tip,
      split_label: p.label ?? undefined,
    }));
    onConfirm(payments, tip);
  };

  return (
    <Modal open={open} onClose={onClose} title="Take payment" wide>
      <div className="space-y-5">
        {/* Tip */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Tip</p>
          <div className="flex gap-1.5">
            {[0, 10, 15, 18, 20].map((p) => (
              <button
                key={p}
                onClick={() => setTipPct(p)}
                className={cn(
                  "flex-1 cursor-pointer rounded-lg border py-2 text-xs font-semibold transition-all",
                  tipPct === p
                    ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                    : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                )}
              >
                {p === 0 ? "No tip" : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Split mode */}
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">How are they paying?</p>
          <div className="flex rounded-xl border border-line bg-white/[0.02] p-1">
            {(
              [
                ["single", "One payment"],
                ["even", "Split evenly"],
                ["item", "Split by dish"],
              ] as ["single" | "even" | "item", string][]
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex-1 cursor-pointer rounded-lg py-2 text-xs font-semibold transition-all",
                  mode === m ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {mode !== "single" && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Number of guests</p>
            <div className="flex gap-1.5">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => setGuests(n)}
                  className={cn(
                    "flex-1 cursor-pointer rounded-lg border py-2 text-xs font-semibold transition-all",
                    guests === n
                      ? "border-accent-400/50 bg-accent-400/10 text-accent-400"
                      : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Assign dishes to guests */}
        {mode === "item" && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-400">Assign each dish</p>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {lines.map((l, i) => (
                <div key={i} className="rounded-xl border border-line bg-white/[0.02] p-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white">
                      {l.qty}× {l.name}
                    </span>
                    <span className="text-zinc-400">{fmt(l.price * l.qty, 2)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Array.from({ length: guests }, (_, g) => (
                      <button
                        key={g}
                        onClick={() => setAssign((p) => ({ ...p, [i]: g }))}
                        className={cn(
                          "cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
                          (assign[i] ?? "shared") === g
                            ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                            : "border-line text-zinc-400 hover:text-white",
                        )}
                      >
                        G{g + 1}
                      </button>
                    ))}
                    <button
                      onClick={() => setAssign((p) => ({ ...p, [i]: "shared" }))}
                      className={cn(
                        "cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all",
                        (assign[i] ?? "shared") === "shared"
                          ? "border-accent-400/50 bg-accent-400/10 text-accent-400"
                          : "border-line text-zinc-400 hover:text-white",
                      )}
                    >
                      Shared
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-payer amounts + method */}
        <div className="space-y-2 rounded-xl border border-line bg-white/[0.02] p-3">
          {payers.map((p, i) => (
            <div key={i} className="flex flex-col gap-2 border-b border-line/60 pb-2 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <span className="font-semibold text-white">{p.label ?? "Total due"}</span>
                <span className="ml-2 text-zinc-500">{fmt(p.amount, 2)}</span>
              </div>
              <div className="flex gap-1">
                {methodMeta.map(([key, Icon, label]) => (
                  <button
                    key={key}
                    onClick={() => setMethod(mode === "single" ? 0 : i, key)}
                    className={cn(
                      "flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all",
                      (mode === "single" ? methods[0] : methods[i]) === key
                        ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                        : "border-line text-zinc-400 hover:text-white",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-1 text-sm">
          {!!discountAmount && discountAmount > 0 && (
            <div className="flex justify-between text-brand-300">
              <span>{discountLabel ?? "Discount"}</span>
              <span>−{fmt(discountAmount, 2)}</span>
            </div>
          )}
          <div className="flex justify-between text-zinc-400">
            <span>Subtotal</span>
            <span>{fmt(subtotal, 2)}</span>
          </div>
          {taxGroups.map((g) => (
            <div key={g.rate} className="flex justify-between text-zinc-400">
              <span>Incl. tax ({g.rate}%)</span>
              <span>{fmt(g.tax, 2)}</span>
            </div>
          ))}
          {tip > 0 && (
            <div className="flex justify-between text-zinc-400">
              <span>Tip ({tipPct}%)</span>
              <span>{fmt(tip, 2)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1 text-base font-bold text-white">
            <span>Total</span>
            <span className="text-gradient">{fmt(total, 2)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button className="flex-[2]" onClick={confirm} disabled={pending}>
            {pending ? "Processing…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A single menu tile — shared by the flat grid and the grouped-by-category view. */
function ProductCard({ r, onAdd, fmt }: { r: Recipe; onAdd: () => void; fmt: (n: number, d?: number) => string }) {
  return (
    <button onClick={onAdd} className="group cursor-pointer text-left">
      <Card className="overflow-hidden p-0 transition-all group-hover:border-brand-400/40 group-hover:shadow-lg group-hover:shadow-brand-500/10 group-active:scale-[0.97]">
        {r.image_url ? (
          <img src={r.image_url} alt={r.name} className="h-20 w-full object-cover" />
        ) : (
          <div className="flex h-20 items-center justify-center bg-white/[0.02] text-4xl">{r.emoji}</div>
        )}
        <div className="p-3">
          <p className="line-clamp-2 min-h-10 text-sm font-semibold text-white">{r.name}</p>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-xs text-zinc-500">{r.category}</span>
            <span className="text-sm font-bold text-brand-300">{fmt(r.price, 2)}</span>
          </div>
        </div>
      </Card>
    </button>
  );
}

export default function Pos() {
  const { org } = useOrg();
  const { user } = useAuth();
  const fmt = useFmt();
  const recipesQ = useRecipes();
  const eventMenusQ = useEventMenus();
  const customersQ = useCustomers();
  const tablesQ = useTables();
  const ordersQ = useOrders();
  const employeesQ = useEmployees();
  const invalidate = useInvalidate();
  const { cart, addToCart, setCartQty, clearCart } = useUi();

  const [tab, setTab] = useState<"order" | "tabs">("order");
  const [category, setCategory] = useState<string>("All");
  const [eventMenuId, setEventMenuId] = useState<string>(""); // "" = full menu
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [customerId, setCustomerId] = useState<string>("");
  const [kitchenNotes, setKitchenNotes] = useState("");
  const [tipPct, setTipPct] = useState<number>(0);
  const [discountType, setDiscountType] = useState<"none" | "percent" | "amount" | "staff">("none");
  // Two different staff actions sharing one segmented-control slot rather
  // than two ("Staff" and "Staff Meal" side by side read as unrelated
  // buttons and crowded the row) — see the panel below.
  const [staffMode, setStaffMode] = useState<"discount" | "meal">("discount");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [staffEmployeeId, setStaffEmployeeId] = useState<string>("");
  const [approvalPin, setApprovalPin] = useState<string>("");
  const [mealPin, setMealPin] = useState<string>("");
  const [address, setAddress] = useState("");
  const [tableId, setTableId] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [settling, setSettling] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<
    (CheckoutResult & { lines: BillLine[]; tax: number; tip: number; method: string }) | null
  >(null);
  // The full, server-computed order for the receipt just paid — used so the
  // POS modal can offer the exact same print/email Beleg as the Orders page,
  // instead of a third, duplicated rendering of the same receipt.
  const receiptOrder = useMemo(
    () => (ordersQ.data ?? []).find((o) => o.id === receipt?.order_id) ?? null,
    [ordersQ.data, receipt?.order_id],
  );

  const recipes = useMemo(
    () => (recipesQ.data ?? []).filter((r) => r.is_active && !isSoldOut(r)),
    [recipesQ.data],
  );

  // Event/popup menus: when one is picked, the grid shows only its dishes.
  const activeEventMenus = useMemo(
    () => (eventMenusQ.data ?? []).filter((m) => m.is_active),
    [eventMenusQ.data],
  );
  const eventMenuIds = useMemo(() => {
    const m = activeEventMenus.find((x) => x.id === eventMenuId);
    return m ? new Set(m.recipe_ids) : null;
  }, [activeEventMenus, eventMenuId]);

  // Every dish that belongs to some event/popup menu — excluded from the
  // default "Restaurant Menu" view so event-only items don't bleed into
  // regular service.
  const eventRecipeIds = useMemo(
    () => new Set(activeEventMenus.flatMap((m) => m.recipe_ids)),
    [activeEventMenus],
  );

  // Pre-prepared event menu → orders skip the Kitchen board entirely.
  const skipKitchen = !!activeEventMenus.find((x) => x.id === eventMenuId)?.skip_kitchen;

  // Dishes in scope for the current menu selection (before category/search).
  // eventMenuId === "" is the default "Restaurant Menu": every active recipe
  // except ones that only belong to an event menu. Picking an event menu
  // narrows the grid to just that menu's dishes.
  const inMenu = useMemo(
    () => (eventMenuIds ? recipes.filter((r) => eventMenuIds.has(r.id)) : recipes.filter((r) => !eventRecipeIds.has(r.id))),
    [recipes, eventMenuIds, eventRecipeIds],
  );

  // Category pills reflect what's actually on the selected menu, in the
  // restaurant's own configured order (Recipes → Category Order) — the same
  // order the printed menu, the QR storefront and the Recipes list all use,
  // so a dish is always in the same place wherever staff look for it.
  const categoryOrder = (org?.settings as { categoryOrder?: string[] } | null)?.categoryOrder;
  const categories = useMemo(
    () => [
      "All",
      ...orderCategories([...new Set(inMenu.map((r) => r.category).filter(Boolean))], categoryOrder),
    ],
    [inMenu, categoryOrder],
  );

  // Switching menus can strand a category that no longer exists — fall back to
  // "All" so the grid never silently renders empty.
  const effectiveCategory = categories.includes(category) ? category : "All";

  const products = useMemo(
    () =>
      inMenu.filter(
        (r) =>
          (effectiveCategory === "All" || r.category === effectiveCategory) &&
          r.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [inMenu, effectiveCategory, query],
  );

  // Browsing "All" with no search: group into Wolt-style labeled sections
  // instead of one undifferentiated wall of cards — staff scan for a
  // category, not search text, most of the time. A specific category or an
  // active search is already a single scoped list, so a header would be
  // redundant there.
  const groupedProducts = useMemo(() => {
    if (effectiveCategory !== "All" || query.trim()) return null;
    const byCategory = new Map<string, Recipe[]>();
    for (const r of products) {
      const list = byCategory.get(r.category) ?? [];
      list.push(r);
      byCategory.set(r.category, list);
    }
    // Same order as the category pills, so the pill bar and the grouped
    // sections agree on where everything is.
    const rank = new Map(categories.map((c, i) => [c, i]));
    return [...byCategory.entries()].sort(
      ([a], [b]) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999),
    );
  }, [products, effectiveCategory, query, categories]);

  const lines = cart
    .map((l) => ({ ...l, recipe: recipes.find((r) => r.id === l.recipeId) }))
    .filter((l) => l.recipe);
  const billLines: BillLine[] = lines.map((l) => ({
    name: l.recipe!.name,
    qty: l.qty,
    price: l.recipe!.price,
    tax_rate: l.recipe!.tax_rate,
  }));
  // VAT-included (gross) pricing, mirroring checkout_order (migration 0017):
  // menu prices already contain VAT, so break it out rather than adding on top.
  // `subtotal` is the NET amount — which is also what PayModal and the settle
  // path expect, since net × rate/100 == the VAT contained in the gross price.
  const taxRate = org?.tax_rate ?? 8.5;
  const gross = lines.reduce((s, l) => s + l.recipe!.price * l.qty, 0);
  const discountNum = Math.max(+discountValue || 0, 0);
  // A staff discount is a percentage like any other, but clamped to the org's
  // ceiling. The server clamps it too — this just stops the till showing a
  // total the checkout would refuse.
  const isStaffDiscount = discountType === "staff";
  const staffMaxPct = org?.staff_discount_max_pct ?? 0;
  const staffMealLimit = org?.staff_meal_daily_limit ?? 0;
  // Both staff actions are enabled, so ask which one; only one is configured,
  // so there's nothing to ask — skip straight to whichever it is.
  const canGiveDiscount = staffMaxPct > 0;
  const canClaimMeal = staffMealLimit > 0;
  const isMealClaim = isStaffDiscount && (staffMode === "meal" || (!canGiveDiscount && canClaimMeal));
  const discountPct =
    discountType === "percent"
      ? Math.min(discountNum, 100)
      : isStaffDiscount && !isMealClaim
        ? Math.min(discountNum, staffMaxPct)
        : 0;
  const discountAmountInput = discountType === "amount" ? discountNum : 0;

  const myEmployee = useMemo(
    () => (employeesQ.data ?? []).find((e) => e.user_id === user?.id) ?? null,
    [employeesQ.data, user?.id],
  );
  // Your own name first (labeled), everyone else after — so claiming your
  // own meal or discount never means searching a long, alphabetical list
  // for yourself first.
  const staffEmployees = useMemo(() => {
    const active = (employeesQ.data ?? []).filter((e) => e.is_active);
    return active.sort((a, b) => {
      if (a.id === myEmployee?.id) return -1;
      if (b.id === myEmployee?.id) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [employeesQ.data, myEmployee]);

  // How much of this month's allowance the chosen employee has left. Refetched
  // per employee; the server checks it again at checkout, so a stale figure
  // here can only ever under-promise, never let an over-limit sale through.
  const staffUsageQ = useQuery({
    queryKey: ["staffDiscountUsage", org?.id, staffEmployeeId],
    queryFn: () => getStaffDiscountUsage(org!.id, staffEmployeeId),
    enabled: !!org?.id && !!staffEmployeeId && isStaffDiscount && !isMealClaim,
  });
  const staffUsage = staffUsageQ.data;

  // Same idea for the meal allowance, but per-day rather than per-month —
  // see 0048. The free portion here is a preview only; the server recomputes
  // it against the real usage at checkout, same as the discount cap above.
  const mealUsageQ = useQuery({
    queryKey: ["staffMealUsage", org?.id, staffEmployeeId],
    queryFn: () => getStaffMealUsage(org!.id, staffEmployeeId),
    enabled: !!org?.id && !!staffEmployeeId && isMealClaim,
  });
  const mealUsage = mealUsageQ.data;
  const mealFreeAmount = isMealClaim && mealUsage ? Math.min(gross, mealUsage.remaining) : 0;
  const mealResidual = isMealClaim ? gross - mealFreeAmount : 0;
  const mealDiscount = isMealClaim ? +(mealFreeAmount + (mealResidual * staffMaxPct) / 100).toFixed(2) : 0;

  const discount = isMealClaim
    ? mealDiscount
    : Math.min(discountAmountInput + gross * (discountPct / 100), gross);
  const discountedGross = +(gross - discount).toFixed(2);
  const taxGroups = computeTaxGroups(billLines, taxRate, discount);
  const tax = sumTax(taxGroups);
  const subtotal = +(discountedGross - tax).toFixed(2);
  const tip = +(discountedGross * (tipPct / 100)).toFixed(2);
  const total = +(discountedGross + tip).toFixed(2);
  const cartCount = lines.reduce((s, l) => s + l.qty, 0);

  const needsPin =
    isStaffDiscount &&
    !isMealClaim &&
    staffUsage?.pin_threshold != null &&
    discount > staffUsage.pin_threshold;
  // Don't let the sale start until the staff discount/meal is actually
  // chargeable — the server would reject it anyway, this just fails earlier
  // and clearer.
  const staffDiscountIncomplete =
    (isStaffDiscount && !isMealClaim && (!staffEmployeeId || discount <= 0 || (needsPin && !approvalPin.trim()))) ||
    (isMealClaim && (!staffEmployeeId || !mealPin.trim() || gross <= 0));
  // Below `md` the cart becomes a slide-up bottom sheet instead of a side column.
  const isDesktopCart = useMediaQuery("(min-width: 768px)");

  const openTabs = useMemo(
    () =>
      (ordersQ.data ?? [])
        .filter((o) => o.status === "open")
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [ordersQ.data],
  );
  const tableName = (id: string | null) =>
    id ? (tablesQ.data ?? []).find((t) => t.id === id)?.name ?? null : null;

  const resetOrder = () => {
    clearCart();
    setKitchenNotes("");
    setTipPct(0);
    setDiscountType("none");
    setStaffMode("discount");
    setDiscountValue("");
    setStaffEmployeeId("");
    setApprovalPin("");
    setMealPin("");
    setCustomerId("");
    setAddress("");
    setTableId("");
    setCartOpen(false);
  };

  // --- Checkout the cart: either pay now, or open a tab (payments: []) ---
  const checkout = useMutation({
    mutationFn: (vars: { payments: PaymentInput[]; tip: number }) =>
      checkoutOrder(org!.id, {
        items: lines.map((l) => ({
          recipe_id: l.recipeId,
          name: l.recipe!.name,
          qty: l.qty,
          price: l.recipe!.price,
        })),
        orderType,
        tableId: orderType === "dine_in" && tableId ? tableId : null,
        customerId: customerId || null,
        kitchenNotes: kitchenNotes || null,
        tip: vars.tip,
        address: orderType === "delivery" ? address : null,
        discountAmount: isMealClaim ? 0 : discountAmountInput,
        discountPct: isMealClaim ? 0 : discountPct,
        staffDiscountEmployeeId: isStaffDiscount ? staffEmployeeId : null,
        approvalPin: isStaffDiscount && !isMealClaim ? approvalPin || null : null,
        mealPin: isMealClaim ? mealPin || null : null,
        org,
        payments: vars.payments,
      }).then(async (result) => {
        // Pre-prepared event menu: hand-over is immediate, so don't queue a
        // ticket on the Kitchen board. Non-fatal if it fails — the order is
        // already placed; it would just show up in Kitchen as usual.
        if (skipKitchen && result.order_id) {
          try {
            await setKitchenStatus(org!.id, result.order_id, "served");
          } catch {
            /* leave it on the board rather than failing the sale */
          }
        }
        return result;
      }),
    onSuccess: (result, vars) => {
      const paid = vars.payments.length > 0;
      const snapshot = billLines;
      resetOrder();
      setPayOpen(false);
      invalidate(
        "orders", "payments", "inventory", "inventory_tx",
        "customers", "deliveries", "restaurant_tables",
      );
      // The allowance just moved — drop the cached figure so the next staff
      // discount/meal reads the real remaining balance, not the pre-sale one.
      staffUsageQ.refetch();
      mealUsageQ.refetch();
      if (paid) {
        const method = vars.payments.length > 1 ? "split" : vars.payments[0].method;
        setReceipt({ ...result, lines: snapshot, tax: +tax.toFixed(2), tip: vars.tip, method });
        toast.success(`Order ${result.order_number} paid`, "Sent to kitchen · inventory updated");
      } else {
        toast.success(`Tab ${result.order_number} opened`, "Sent to kitchen · settle when guests are done");
        setTab("tabs");
      }
    },
    onError: (e) => toast.error("Checkout failed", e instanceof Error ? e.message : "Try again"),
  });

  // --- Settle an existing open tab ---
  const settle = useMutation({
    mutationFn: (vars: { order: Order; payments: PaymentInput[]; tip: number }) =>
      markOrderPaid(org!.id, vars.order.id, vars.payments, vars.tip),
    onSuccess: (_r, vars) => {
      setSettling(null);
      invalidate("orders", "payments", "customers");
      toast.success(`Tab ${vars.order.order_number} settled`, fmt(vars.order.total, 2));
    },
    onError: (e) => toast.error("Settle failed", e instanceof Error ? e.message : "Try again"),
  });

  if (recipesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle title="Point of Sale" subtitle="Sales flow straight into kitchen, inventory and analytics." />
        <div className="flex rounded-xl border border-line bg-white/[0.02] p-1">
          <button
            onClick={() => setTab("order")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
              tab === "order" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
            )}
          >
            <ShoppingBag className="h-3.5 w-3.5" /> New order
          </button>
          <button
            onClick={() => setTab("tabs")}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
              tab === "tabs" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
            )}
          >
            <Receipt className="h-3.5 w-3.5" /> Open tabs
            {openTabs.length > 0 && (
              <span className="rounded-full bg-accent-400/20 px-1.5 text-[10px] font-bold text-accent-400">
                {openTabs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {tab === "tabs" ? (
        <OpenTabsView
          tabs={openTabs}
          tableName={tableName}
          onSettle={(o) => setSettling(o)}
          loading={ordersQ.isLoading}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_370px]">
          {/* Product grid */}
          <div className="space-y-4">
            {activeEventMenus.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white/[0.02] p-1.5">
                <span className="px-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                  Menu
                </span>
                <button
                  onClick={() => setEventMenuId("")}
                  className={cn(
                    "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    eventMenuId === ""
                      ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                      : "text-zinc-400 hover:text-white",
                  )}
                >
                  Restaurant Menu
                </button>
                {activeEventMenus.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setEventMenuId(m.id)}
                    className={cn(
                      "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                      eventMenuId === m.id
                        ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                        : "text-zinc-400 hover:text-white",
                    )}
                  >
                    {m.name}
                    <span className="ml-1.5 opacity-60">{m.recipe_ids.length}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex min-w-0 flex-col gap-3">
              <div className="relative min-w-0 sm:max-w-xs">
                <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input placeholder="Search menu…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
              </div>
              {/*
                Categories get the full width on their own row and WRAP from `sm`
                up, so every name is fully readable at a glance — a half-clipped
                pill is the one thing staff can't act on quickly mid-order.
                Below `sm` there isn't room to wrap without eating the screen,
                so it stays a swipeable strip with a fade hinting at more.
              */}
              <div className="relative min-w-0">
                <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        "shrink-0 cursor-pointer rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all",
                        category === c
                          ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                          : "border border-line bg-white/[0.03] text-zinc-300 hover:text-white",
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-base to-transparent sm:hidden" />
              </div>
            </div>

            {recipes.length === 0 ? (
              <Card>
                <EmptyState
                  icon={UtensilsCrossed}
                  title="No menu items yet"
                  hint="Add recipes first — they appear here automatically."
                />
              </Card>
            ) : groupedProducts ? (
              <div className="space-y-6">
                {groupedProducts.map(([cat, items]) => (
                  <div key={cat}>
                    <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-400 uppercase">{cat}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                      {items.map((r) => (
                        <ProductCard key={r.id} r={r} onAdd={() => addToCart(r.id)} fmt={fmt} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {products.map((r) => (
                  <ProductCard key={r.id} r={r} onAdd={() => addToCart(r.id)} fmt={fmt} />
                ))}
                {products.length === 0 && (
                  <p className="col-span-full py-10 text-center text-sm text-zinc-500">No items match “{query}”.</p>
                )}
              </div>
            )}
          </div>

          {/* Cart — side column on md+, slide-up bottom sheet on mobile */}
          {!isDesktopCart && cartOpen && (
            <div
              className="animate-fade fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setCartOpen(false)}
            />
          )}
          <Card
            className={cn(
              "h-fit flex-col p-5",
              "md:flex md:!static md:inset-auto md:bottom-auto md:z-auto md:max-h-none md:overflow-visible lg:sticky lg:top-20",
              cartOpen
                ? "animate-rise fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 flex max-h-[78vh] overflow-y-auto"
                : "hidden",
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold text-white">
                <ShoppingBag className="h-4 w-4 text-brand-300" /> Current Order
              </h3>
              {cart.length > 0 && (
                <button onClick={resetOrder} className="cursor-pointer text-xs text-zinc-500 hover:text-rose-soft">
                  Clear
                </button>
              )}
            </div>

            {/* Order type */}
            <div className="mb-3 flex rounded-xl border border-line bg-white/[0.02] p-1">
              {(
                [
                  ["dine_in", "Dine-in"],
                  ["takeaway", "Takeaway"],
                  ["delivery", "Delivery"],
                ] as [OrderType, string][]
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={cn(
                    "flex-1 cursor-pointer rounded-lg py-1.5 text-xs font-semibold transition-all",
                    orderType === t ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {lines.length === 0 ? (
              <p className="py-10 text-center text-sm text-zinc-500">Tap items to start an order.</p>
            ) : (
              <>
                <div className="space-y-2.5">
                  {lines.map((l) => (
                    <div key={l.recipeId} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-2.5">
                      <span className="text-xl">{l.recipe!.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white">{l.recipe!.name}</p>
                        <p className="text-xs text-zinc-500">{fmt(l.recipe!.price, 2)} each</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setCartQty(l.recipeId, l.qty - 1)} className="cursor-pointer rounded-lg bg-white/5 p-1 text-zinc-300 hover:bg-white/10">
                          {l.qty === 1 ? <Trash2 className="h-3.5 w-3.5 text-rose-soft" /> : <Minus className="h-3.5 w-3.5" />}
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-white">{l.qty}</span>
                        <button onClick={() => addToCart(l.recipeId)} className="cursor-pointer rounded-lg bg-white/5 p-1 text-zinc-300 hover:bg-white/10">
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Customer + notes */}
                <div className="mt-3 space-y-2">
                  {orderType === "dine_in" && (tablesQ.data ?? []).length > 0 && (
                    <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                      <option value="">No table</option>
                      {(tablesQ.data ?? [])
                        .filter((t) => t.status === "open" || t.id === tableId)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            Table {t.name} · {t.seats} seats · {t.zone}
                          </option>
                        ))}
                    </Select>
                  )}
                  <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                    <option value="">Walk-in guest</option>
                    {(customersQ.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.tier}
                      </option>
                    ))}
                  </Select>
                  <Input
                    placeholder="Kitchen note (allergies, mods…)"
                    value={kitchenNotes}
                    onChange={(e) => setKitchenNotes(e.target.value)}
                  />
                  {orderType === "delivery" && (
                    <Input
                      placeholder="Delivery address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  )}
                </div>

                {/* Tip */}
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-zinc-400">Tip</p>
                  <div className="flex gap-1">
                    {[0, 10, 15, 20].map((p) => (
                      <button
                        key={p}
                        onClick={() => setTipPct(p)}
                        className={cn(
                          "flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-semibold transition-all",
                          tipPct === p
                            ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                            : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                        )}
                      >
                        {p === 0 ? "No tip" : `${p}%`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Discount */}
                <div className="mt-3">
                  <p className="mb-1.5 text-xs font-medium text-zinc-400">Discount</p>
                  <div className="flex gap-1">
                    {(
                      [
                        ["none", "None"],
                        ["percent", "%"],
                        ["amount", "Amount"],
                        ...(canGiveDiscount || canClaimMeal ? ([["staff", "Staff"]] as ["staff", string][]) : []),
                      ] as ["none" | "percent" | "amount" | "staff", string][]
                    ).map(([t, label]) => (
                      <button
                        key={t}
                        onClick={() => {
                          setDiscountType(t);
                          // Whoever's at the till is the most likely person the
                          // action is for — pre-select them, still changeable.
                          if (t === "staff" && myEmployee) setStaffEmployeeId(myEmployee.id);
                        }}
                        className={cn(
                          "flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-semibold transition-all",
                          discountType === t
                            ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                            : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                    {discountType !== "none" && !isMealClaim && (
                      <Input
                        type="number"
                        min="0"
                        max={isStaffDiscount ? staffMaxPct : undefined}
                        step={discountType === "amount" ? "0.5" : "1"}
                        placeholder={isStaffDiscount ? String(staffMaxPct) : discountType === "percent" ? "10" : "5.00"}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        className="w-20 text-center"
                        autoFocus
                      />
                    )}
                  </div>

                  {isStaffDiscount && (
                    <div className="mt-2 space-y-2 rounded-xl border border-line bg-white/[0.02] p-2.5">
                      {/* Two different actions sharing the "Staff" slot — only
                          worth asking when both are actually configured. */}
                      {canGiveDiscount && canClaimMeal && (
                        <div className="flex gap-1.5">
                          {(
                            [
                              ["discount", "Give a discount"],
                              ["meal", "My meal"],
                            ] as ["discount" | "meal", string][]
                          ).map(([m, label]) => (
                            <button
                              key={m}
                              onClick={() => {
                                setStaffMode(m);
                                setApprovalPin("");
                                setMealPin("");
                              }}
                              className={cn(
                                "flex-1 cursor-pointer rounded-lg border py-1.5 text-xs font-semibold transition-all",
                                staffMode === m
                                  ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                                  : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}

                      {isMealClaim ? (
                        <>
                          <p className="text-xs text-zinc-500">
                            Free up to today&rsquo;s allowance — enter your own PIN to confirm it&rsquo;s you. Ordering
                            more just charges the rest at the staff rate; nothing is blocked.
                          </p>
                          <Select
                            value={staffEmployeeId}
                            onChange={(e) => {
                              setStaffEmployeeId(e.target.value);
                              setMealPin("");
                            }}
                            className="text-xs"
                          >
                            <option value="">Who&rsquo;s this for?</option>
                            {staffEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.id === myEmployee?.id ? `${e.name} (you)` : e.name}
                              </option>
                            ))}
                          </Select>

                          {staffEmployeeId && mealUsage && (
                            <p className="text-xs text-zinc-500">
                              <strong className={cn(mealFreeAmount < gross ? "text-amber-300" : "text-zinc-300")}>
                                {fmt(mealUsage.remaining, 2)}
                              </strong>{" "}
                              left today
                              {mealUsage.limit != null && <> of {fmt(mealUsage.limit, 2)}</>}
                              {mealResidual > 0 && (
                                <>
                                  {" "}
                                  · {fmt(mealResidual, 2)} over, charged at {staffMaxPct}% off
                                </>
                              )}
                            </p>
                          )}

                          {staffEmployeeId && (
                            <Input
                              type="password"
                              inputMode="numeric"
                              placeholder="Your PIN"
                              value={mealPin}
                              onChange={(e) => setMealPin(e.target.value)}
                              className="text-xs"
                            />
                          )}
                        </>
                      ) : (
                        <>
                          <Select
                            value={staffEmployeeId}
                            onChange={(e) => {
                              setStaffEmployeeId(e.target.value);
                              setApprovalPin("");
                            }}
                            className="text-xs"
                          >
                            <option value="">Whose discount is this?</option>
                            {staffEmployees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.id === myEmployee?.id ? `${e.name} (you)` : e.name}
                              </option>
                            ))}
                          </Select>

                          {staffEmployeeId && staffUsage && (
                            <p className="text-xs text-zinc-500">
                              Up to {staffUsage.max_pct}% ·{" "}
                              {staffUsage.cap == null ? (
                                <>no monthly limit</>
                              ) : (
                                <>
                                  <strong
                                    className={cn(
                                      (staffUsage.remaining ?? 0) < discount ? "text-rose-300" : "text-zinc-300",
                                    )}
                                  >
                                    {fmt(staffUsage.remaining ?? 0, 2)}
                                  </strong>{" "}
                                  left of {fmt(staffUsage.cap, 2)} this month
                                </>
                              )}
                              {staffUsage.orders > 0 && <> · {staffUsage.orders} so far</>}
                            </p>
                          )}

                          {needsPin && (
                            <Input
                              type="password"
                              inputMode="numeric"
                              placeholder={`Manager PIN (over ${fmt(staffUsage!.pin_threshold!, 2)})`}
                              value={approvalPin}
                              onChange={(e) => setApprovalPin(e.target.value)}
                              className="text-xs"
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
                  {discount > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Items</span>
                      <span>{fmt(gross, 2)}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-brand-300">
                      <span>
                        {isMealClaim ? "Staff meal" : isStaffDiscount ? "Staff discount" : "Discount"}
                        {discountType !== "amount" && !isMealClaim ? ` (${discountPct}%)` : ""}
                      </span>
                      <span>−{fmt(discount, 2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-zinc-400">
                    <span>Subtotal</span>
                    <span>{fmt(subtotal, 2)}</span>
                  </div>
                  {taxGroups.map((g) => (
                    <div key={g.rate} className="flex justify-between text-zinc-400">
                      <span>Incl. tax ({g.rate}%)</span>
                      <span>{fmt(g.tax, 2)}</span>
                    </div>
                  ))}
                  {tip > 0 && (
                    <div className="flex justify-between text-zinc-400">
                      <span>Tip ({tipPct}%)</span>
                      <span>{fmt(tip, 2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-1 text-base font-bold text-white">
                    <span>Total</span>
                    <span className="text-gradient">{fmt(total, 2)}</span>
                  </div>
                </div>

                {/* Quick payment method (for one-tap charge) */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {methodMeta.map(([key, Icon, label]) => (
                    <button
                      key={key}
                      onClick={() => setPayment(key)}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-xl border p-2.5 text-xs font-medium transition-all",
                        payment === key
                          ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                          : "border-line bg-white/[0.02] text-zinc-400 hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* Actions */}
                {orderType === "dine_in" && (
                  <Button
                    variant="ghost"
                    className="mt-3 w-full"
                    onClick={() => checkout.mutate({ payments: [], tip: 0 })}
                    disabled={checkout.isPending || staffDiscountIncomplete}
                  >
                    <ChefHat className="h-4 w-4" /> Send to kitchen · pay later
                  </Button>
                )}

                <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
                  <Button
                    onClick={() => checkout.mutate({ payments: [{ method: payment, amount: total, tip_amount: tip }], tip })}
                    disabled={checkout.isPending || staffDiscountIncomplete}
                  >
                    {checkout.isPending ? "Processing…" : `Charge ${fmt(total, 2)}`}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPayOpen(true)}
                    disabled={checkout.isPending || staffDiscountIncomplete}
                    title="Split bill / multiple payers"
                  >
                    <SplitSquareHorizontal className="h-4 w-4" /> Split
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* Mobile: collapsed cart bar that opens the sheet */}
          {!isDesktopCart && !cartOpen && cartCount > 0 && (
            <button
              onClick={() => setCartOpen(true)}
              className="animate-rise fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line bg-raised/95 px-4 py-3 shadow-2xl shadow-black/40 backdrop-blur md:hidden"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-gradient-to-r from-brand-500 to-accent-400 px-1.5 text-xs font-bold text-zinc-950">
                  {cartCount}
                </span>
                View order
              </span>
              <span className="text-gradient text-sm font-bold">{fmt(total, 2)}</span>
            </button>
          )}
        </div>
      )}

      {/* Split / pay modal for a new cart */}
      <PayModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        lines={billLines}
        subtotal={subtotal}
        taxGroups={taxGroups}
        initialTipPct={tipPct}
        discountAmount={discount}
        discountLabel={discountType === "percent" ? `Discount (${discountPct}%)` : "Discount"}
        confirmLabel={`Charge ${fmt(total, 2)}`}
        pending={checkout.isPending}
        onConfirm={(payments, t) => checkout.mutate({ payments, tip: t })}
      />

      {/* Settle modal for an open tab */}
      {settling && (
        <PayModal
          open={!!settling}
          onClose={() => setSettling(null)}
          lines={settling.items as BillLine[]}
          subtotal={settling.subtotal}
          taxGroups={computeTaxGroups(settling.items, taxRate, settling.discount || 0)}
          initialTipPct={0}
          discountAmount={settling.discount}
          discountLabel="Discount"
          confirmLabel={`Settle ${settling.order_number}`}
          pending={settle.isPending}
          onConfirm={(payments, t) => settle.mutate({ order: settling, payments, tip: t })}
        />
      )}

      {/* Receipt modal */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} title="Payment successful">
        {receipt && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-2">
              <CheckCircle2 className="h-12 w-12 text-brand-400" />
              <p className="font-display text-2xl font-bold text-white">{fmt(receipt.total, 2)}</p>
              <Badge tone="green" className="capitalize">Paid · {receipt.method}</Badge>
              <p className="text-xs text-zinc-500">{receipt.order_number} · sent to kitchen</p>
            </div>
            <div className="space-y-1.5 rounded-xl border border-line bg-white/[0.02] p-4 text-sm">
              {receipt.lines.map((l) => (
                <div key={l.name} className="flex justify-between text-zinc-300">
                  <span>{l.qty}× {l.name}</span>
                  <span>{fmt(l.price * l.qty, 2)}</span>
                </div>
              ))}
              {!!receipt.discount && receipt.discount > 0 && (
                <div className="flex justify-between border-t border-line pt-2 text-brand-300">
                  <span>Discount</span>
                  <span>−{fmt(receipt.discount, 2)}</span>
                </div>
              )}
              <div className={cn("flex justify-between text-zinc-400", !(receipt.discount && receipt.discount > 0) && "border-t border-line pt-2")}>
                <span>Tax</span>
                <span>{fmt(receipt.tax, 2)}</span>
              </div>
              {receipt.tip > 0 && (
                <div className="flex justify-between text-zinc-400">
                  <span>Tip</span>
                  <span>{fmt(receipt.tip, 2)}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {receiptOrder && (
                <>
                  {/* Direct print first — it's what staff reach for most. The
                      Beleg preview stays for emailing or checking the bill. */}
                  <PrintReceiptButton order={receiptOrder} />
                  <ReceiptButton order={receiptOrder} />
                </>
              )}
              <Button className="flex-1" onClick={() => setReceipt(null)}>
                New Order
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open tabs — dine-in orders sent to the kitchen but not yet paid.
// ---------------------------------------------------------------------------
function OpenTabsView({
  tabs,
  tableName,
  onSettle,
  loading,
}: {
  tabs: Order[];
  tableName: (id: string | null) => string | null;
  onSettle: (o: Order) => void;
  loading: boolean;
}) {
  const fmt = useFmt();
  const kitchenTone: Record<string, "neutral" | "amber" | "green" | "cyan"> = {
    new: "neutral",
    preparing: "amber",
    ready: "cyan",
    served: "green",
  };

  if (!loading && tabs.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Receipt}
          title="No open tabs"
          hint="Dine-in orders you send to the kitchen without paying show up here to settle later."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {tabs.map((o) => {
        const tn = tableName(o.table_id);
        return (
          <Card key={o.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-white">
                  {tn ? `Table ${tn}` : o.guest_name || "Walk-in"}
                </p>
                <p className="text-xs text-zinc-500">{o.order_number}</p>
              </div>
              <Badge tone={kitchenTone[o.kitchen_status] ?? "neutral"} className="capitalize">
                {o.kitchen_status}
              </Badge>
            </div>

            <div className="mt-3 space-y-1 text-sm">
              {(o.items as BillLine[]).slice(0, 4).map((l, i) => (
                <div key={i} className="flex justify-between text-zinc-400">
                  <span className="truncate">{l.qty}× {l.name}</span>
                  <span>{fmt(l.price * l.qty, 2)}</span>
                </div>
              ))}
              {(o.items as BillLine[]).length > 4 && (
                <p className="text-xs text-zinc-600">+{(o.items as BillLine[]).length - 4} more…</p>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {timeAgo(o.created_at)}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {o.source === "storefront"
                    ? "Online"
                    : o.order_type === "dine_in"
                      ? "Dine-in"
                      : o.order_type === "takeaway"
                        ? "Takeaway"
                        : "Delivery"}
                </span>
              </span>
              <span className="text-base font-bold text-white">{fmt(o.total, 2)}</span>
            </div>

            <Button className="mt-3 w-full" onClick={() => onSettle(o)}>
              <CreditCard className="h-4 w-4" /> Settle bill
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
