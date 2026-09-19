"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Minus, CircleDot, CheckCircle2, CalendarClock, UtensilsCrossed, Gift, Ticket } from "lucide-react";
import { Card, Button, Badge, Input, Field, Modal } from "@/components/ui";
import { fetchPublicMenu, placePublicOrder, placePublicReservation, type PublicMenu } from "@/lib/api/public";
import { currencyFormatter, isSoldOut } from "@/lib/calc";
import { orderCategories } from "@/lib/category-order";
import { cn, errorMessage, fmtNumber } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { getRememberedEmail, rememberEmail } from "@/lib/storefront-identity";

// Same symbols as the recipe editor's dietary toggle (src/views/Recipes.tsx)
// and the printed menu sheet — one consistent icon for a tagged dish everywhere.
const DIET_SYMBOL: Record<"veg" | "vegan", string> = { veg: "🟢", vegan: "🌱" };

export default function Storefront({
  slug,
  tableName,
  orderType = "dine_in",
  initialMenu = null,
}: {
  slug: string;
  tableName: string | null;
  orderType?: "dine_in" | "takeaway";
  initialMenu?: PublicMenu | null;
}) {
  const menuQ = useQuery({
    queryKey: ["public-menu", slug],
    queryFn: () => fetchPublicMenu(slug),
    initialData: initialMenu ?? undefined,
  });
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [guestName, setGuestName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmation, setConfirmation] = useState<{ order_number: string; total?: number; paid?: boolean } | null>(null);
  const [reserving, setReserving] = useState(false);
  const [reserved, setReserved] = useState(false);
  const [resForm, setResForm] = useState({
    name: "",
    phone: "",
    party: "2",
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: "19:00",
    note: "",
  });

  const [lang, setLang] = useState<"en" | "de">("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("storefront-lang");
      if (saved === "de" || saved === "en") setLang(saved);
    } catch { /* private browsing, etc. — default stands */ }
    // Prefill from a prior visit — same convenience as remembering language,
    // not a real login. See src/lib/storefront-identity.ts.
    const rememberedEmail = getRememberedEmail();
    if (rememberedEmail) setEmail(rememberedEmail);
  }, []);
  const changeLang = (next: "en" | "de") => {
    setLang(next);
    try { localStorage.setItem("storefront-lang", next); } catch { /* ignore */ }
  };
  // German falls back to English field by field, so a half-translated menu
  // shows the translations that exist rather than gaps where they don't —
  // same rule menu-sheet.ts uses for the printed sheet.
  const pick = (de: string | null, en: string) => (lang === "de" && de ? de : en);

  const [zoomedItem, setZoomedItem] = useState<{ image_url: string; name: string } | null>(null);
  const [voucher, setVoucher] = useState<{ code: string; reward: string } | null>(null);

  const menu = menuQ.data;
  const fmt = useMemo(() => currencyFormatter(menu?.org.currency ?? "USD"), [menu?.org.currency]);

  const categories = useMemo(() => {
    if (!menu) return [];
    const present = [...new Set(menu.recipes.map((r) => r.category))];
    return orderCategories(present, menu.org.category_order);
  }, [menu]);

  // Grouping/filtering always keys off the English category (above) — never
  // the translated label. Recipes in the same category can have inconsistent
  // (or missing) category_de, and keying by the display label instead once
  // silently dropped a whole category's items on the printed menu when they
  // did (see menu-sheet.ts buildSections()). This only resolves what heading
  // text to show; upgrades from the English fallback the moment any recipe
  // in the category supplies a real translation.
  const categoryDisplay = useMemo(() => {
    const map = new Map<string, string>();
    if (!menu) return map;
    for (const r of menu.recipes) {
      if (!map.has(r.category) || (lang === "de" && r.category_de && map.get(r.category) === r.category)) {
        map.set(r.category, pick(r.category_de, r.category));
      }
    }
    return map;
  }, [menu, lang]);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryId = (cat: string) => `cat-${cat.replace(/\s+/g, "-").toLowerCase()}`;
  const scrollToCategory = (cat: string) => {
    setActiveCategory(cat);
    document.getElementById(categoryId(cat))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Tracks whichever section is nearest the top of the viewport, so the pill
  // bar reflects where the diner actually scrolled to, not only a click.
  useEffect(() => {
    if (!categories.length) return;
    const labelById = new Map(categories.map((c) => [categoryId(c), c]));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const label = visible[0] && labelById.get(visible[0].target.id);
        if (label) setActiveCategory(label);
      },
      { rootMargin: "-64px 0px -70% 0px" },
    );
    const els = categories.map((c) => document.getElementById(categoryId(c))).filter((el): el is HTMLElement => !!el);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [categories]);

  const setQty = (id: string, qty: number) =>
    setCart((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });

  const lines = useMemo(() => {
    if (!menu) return [];
    return [...cart.entries()]
      .map(([id, qty]) => ({ recipe: menu.recipes.find((r) => r.id === id), qty }))
      .filter((l) => l.recipe);
  }, [cart, menu]);
  const subtotal = lines.reduce((s, l) => s + l.recipe!.price * l.qty, 0);
  const tax = subtotal * ((menu?.org.tax_rate ?? 0) / 100);

  // Handle the redirect back from Stripe-hosted checkout (?paid / ?cancelled)
  // and from redeeming a reward on the rewards page (?voucher / ?reward).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paid = params.get("paid");
    const cancelled = params.get("cancelled");
    const voucherCode = params.get("voucher");
    const voucherReward = params.get("reward");
    if (paid) {
      setConfirmation({ order_number: paid, paid: true });
    } else if (cancelled) {
      toast.error("Payment cancelled", `Order ${cancelled} is unpaid — you can pay at the counter.`);
    } else if (voucherCode) {
      setVoucher({ code: voucherCode, reward: voucherReward ?? "Reward" });
      toast.success("Reward applied", `${voucherReward ?? "Your reward"} will be applied at checkout`);
    }
    if (paid || cancelled || voucherCode) {
      // Strip the query so a refresh doesn't re-trigger.
      window.history.replaceState({}, "", `/r/${slug}`);
    }
  }, [slug]);

  const placeOrder = useMutation({
    mutationFn: async () => {
      const result = await placePublicOrder(
        slug,
        [...cart.entries()].map(([recipe_id, qty]) => ({ recipe_id, qty })),
        guestName.trim() || "Guest",
        tableName,
        notes.trim() || null,
        { email: email.trim() || null, code: voucher?.code ?? null, orderType },
      );
      // If the restaurant accepts online payments, start a Stripe Checkout.
      // Otherwise (409 / no Stripe) fall back to pay-at-counter.
      try {
        const origin = window.location.origin;
        const res = await fetch("/api/payments/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: result.order_id,
            successUrl: `${origin}/r/${slug}?paid=${result.order_number}`,
            cancelUrl: `${origin}/r/${slug}?cancelled=${result.order_number}`,
          }),
        });
        if (res.ok) {
          const { url } = await res.json();
          if (url) return { kind: "redirect" as const, url };
        }
      } catch {
        // network/unsupported — fall through to counter confirmation
      }
      return { kind: "counter" as const, result };
    },
    onSuccess: (data) => {
      setCart(new Map());
      setNotes("");
      setVoucher(null);
      rememberEmail(email);
      if (data.kind === "redirect") {
        window.location.href = data.url; // hand off to Stripe-hosted checkout
        return;
      }
      setConfirmation(data.result);
    },
  });

  const reserve = useMutation({
    mutationFn: () =>
      placePublicReservation(
        slug,
        resForm.name.trim(),
        resForm.phone.trim(),
        +resForm.party || 2,
        new Date(`${resForm.date}T${resForm.time}`).toISOString(),
        resForm.note.trim() || null,
      ),
    onSuccess: () => {
      setReserving(false);
      setReserved(true);
    },
  });

  if (menuQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand-400" />
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <UtensilsCrossed className="h-10 w-10 text-zinc-600" />
        <h1 className="font-display text-2xl font-bold text-white">Restaurant not found</h1>
        <p className="text-sm text-zinc-500">Check the link — this menu may have moved.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28">
      {/* Hero */}
      <header className="relative border-b border-line">
        <div className="absolute top-3 right-3 flex items-center gap-0.5 rounded-full border border-line bg-white/[0.03] p-0.5">
          <button
            onClick={() => changeLang("en")}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all",
              lang === "en" ? "bg-white/10 text-white" : "text-zinc-500",
            )}
          >
            EN
          </button>
          <button
            onClick={() => changeLang("de")}
            className={cn(
              "cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all",
              lang === "de" ? "bg-white/10 text-white" : "text-zinc-500",
            )}
          >
            DE
          </button>
        </div>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-10 text-center">
          {menu.org.logo_url ? (
            <img src={menu.org.logo_url} alt={menu.org.name} className="h-20 w-20 rounded-2xl object-cover ring-1 ring-white/15" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-400">
              <span className="font-display text-3xl font-bold text-zinc-950">{menu.org.name[0]}</span>
            </div>
          )}
          <h1 className="font-display text-3xl font-bold text-white">{menu.org.name}</h1>
          {tableName && <Badge tone="cyan">Ordering for table {tableName}</Badge>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setReserving(true)}>
              <CalendarClock className="h-4 w-4" /> Book a Table
            </Button>
            <Link
              href={`/r/${slug}/rewards`}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.03] px-4 py-2 text-sm font-semibold text-zinc-200 transition-all hover:border-zinc-500 hover:bg-white/[0.06] active:scale-[0.97]"
            >
              <Gift className="h-4 w-4" /> Rewards
            </Link>
          </div>
        </div>
      </header>

      {/* Category quick-jump — sticky so a long menu stays easy to navigate on mobile. */}
      {categories.length > 1 && (
        <nav className="sticky top-0 z-30 border-b border-line bg-base/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl gap-1.5 overflow-x-auto px-4 py-2.5">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => scrollToCategory(cat)}
                className={cn(
                  "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                  activeCategory === cat
                    ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                    : "border border-line bg-white/[0.03] text-zinc-400",
                )}
              >
                {categoryDisplay.get(cat) ?? cat}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Menu */}
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        {menu.recipes.some((r) => r.diet === "veg" || r.diet === "vegan") && (
          <p className="-mt-2 text-xs text-zinc-500">{pick("🟢 Vegetarisch · 🌱 Vegan", "🟢 Vegetarian · 🌱 Vegan")}</p>
        )}
        {categories.map((cat) => (
          <section key={cat} id={categoryId(cat)} className="scroll-mt-16">
            <h2 className="mb-3 font-display text-lg font-bold text-white">{categoryDisplay.get(cat) ?? cat}</h2>
            <div className="space-y-2.5">
              {menu.recipes
                .filter((r) => r.category === cat)
                .map((r) => {
                  const qty = cart.get(r.id) ?? 0;
                  const soldOut = isSoldOut(r);
                  const name = pick(r.name_de, r.name);
                  const description = pick(r.description_de, r.description ?? "") || null;
                  return (
                    <Card
                      key={r.id}
                      className={cn("flex items-center gap-3 p-3", qty > 0 && "border-brand-400/40", soldOut && "opacity-50")}
                    >
                      {r.image_url ? (
                        <button
                          onClick={() => setZoomedItem({ image_url: r.image_url!, name })}
                          className="h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-xl"
                        >
                          <img src={r.image_url} alt={name} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/[0.03] text-2xl">
                          {r.emoji}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white">
                          {r.diet && <span className="mr-1">{DIET_SYMBOL[r.diet]}</span>}
                          {name}
                        </p>
                        {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
                        <p className="mt-0.5 text-sm font-bold text-brand-300">{fmt(r.price, 2)}</p>
                      </div>
                      {soldOut ? (
                        <Badge tone="neutral">Sold out</Badge>
                      ) : qty === 0 ? (
                        <button
                          onClick={() => setQty(r.id, 1)}
                          className="cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 p-2 text-zinc-950 transition-all active:scale-90"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button onClick={() => setQty(r.id, qty - 1)} className="cursor-pointer rounded-lg bg-white/10 p-1.5 text-white">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-5 text-center font-bold text-white">{qty}</span>
                          <button onClick={() => setQty(r.id, qty + 1)} className="cursor-pointer rounded-lg bg-white/10 p-1.5 text-white">
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </Card>
                  );
                })}
            </div>
          </section>
        ))}
      </main>

      {/* Sticky order bar */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl space-y-3 px-4 py-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input placeholder="Your name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              <Input placeholder="Email (optional — for rewards points)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Input placeholder="Note for the kitchen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {voucher && (
              <div className="flex items-center justify-between rounded-xl border border-brand-400/30 bg-brand-400/5 px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-2 text-brand-300">
                  <Ticket className="h-4 w-4" /> {voucher.reward} applied · {voucher.code}
                </span>
                <button onClick={() => setVoucher(null)} className="cursor-pointer text-xs text-zinc-400 hover:text-white">Remove</button>
              </div>
            )}
            <Button className="w-full py-3" onClick={() => placeOrder.mutate()} disabled={placeOrder.isPending}>
              {placeOrder.isPending
                ? "Sending…"
                : `Place Order · ${fmt(subtotal + tax, 2)} (incl. tax)`}
            </Button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mx-auto max-w-3xl px-4 pt-4 pb-8 text-center">
        <p className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
          <CircleDot className="h-3.5 w-3.5" /> Powered by Dish<span className="text-gradient font-semibold">Data</span>
        </p>
      </footer>

      {/* Order confirmation */}
      <Modal
        open={!!confirmation}
        onClose={() => setConfirmation(null)}
        title={confirmation?.paid ? "Payment received!" : "Order sent to the kitchen!"}
      >
        {confirmation && (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-400" />
            <p className="font-display text-2xl font-bold text-white">{confirmation.order_number}</p>
            <p className="text-sm text-zinc-400">
              {confirmation.paid ? (
                <>Thank you — your payment went through and the kitchen has your order!</>
              ) : (
                <>
                  Total{" "}
                  <span className="font-semibold text-brand-300">
                    {confirmation.total != null ? fmt(confirmation.total, 2) : ""}
                  </span>{" "}
                  — please pay at the counter. The kitchen has your order!
                </>
              )}
            </p>
            <Button className="w-full" onClick={() => setConfirmation(null)}>
              Order More
            </Button>
          </div>
        )}
      </Modal>

      {/* Reservation modal */}
      <Modal open={reserving} onClose={() => setReserving(false)} title={`Book a table at ${menu.org.name}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Your name">
              <Input value={resForm.name} onChange={(e) => setResForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </Field>
            <Field label="Phone">
              <Input value={resForm.phone} onChange={(e) => setResForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Date">
              <Input type="date" value={resForm.date} onChange={(e) => setResForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field label="Time">
              <Input type="time" value={resForm.time} onChange={(e) => setResForm((f) => ({ ...f, time: e.target.value }))} />
            </Field>
            <Field label="Party size">
              <Input type="number" min="1" max="30" value={resForm.party} onChange={(e) => setResForm((f) => ({ ...f, party: e.target.value }))} />
            </Field>
            <Field label="Note (optional)">
              <Input value={resForm.note} onChange={(e) => setResForm((f) => ({ ...f, note: e.target.value }))} placeholder="Window seat…" />
            </Field>
          </div>
          {reserve.isError && (
            <p className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs text-rose-soft">
              {reserve.error instanceof Error ? reserve.error.message : "Could not book — try another time."}
            </p>
          )}
          <Button className="w-full" disabled={!resForm.name.trim() || reserve.isPending} onClick={() => reserve.mutate()}>
            {reserve.isPending ? "Booking…" : "Confirm Reservation"}
          </Button>
        </div>
      </Modal>

      <Modal open={reserved} onClose={() => setReserved(false)} title="Reservation confirmed!">
        <div className="space-y-4 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-brand-400" />
          <p className="text-sm text-zinc-400">
            See you on {new Date(`${resForm.date}T${resForm.time}`).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} — party of {resForm.party}. The restaurant has been notified.
          </p>
          <Button className="w-full" onClick={() => setReserved(false)}>
            Done
          </Button>
        </div>
      </Modal>

      {/* Photo zoom */}
      <Modal open={!!zoomedItem} onClose={() => setZoomedItem(null)} title={zoomedItem?.name ?? ""} wide>
        {zoomedItem && (
          <img src={zoomedItem.image_url} alt={zoomedItem.name} className="w-full rounded-xl object-cover" />
        )}
      </Modal>
    </div>
  );
}
