"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Minus, CircleDot, CheckCircle2, CalendarClock, UtensilsCrossed, Gift, Award, Ticket, Sparkles } from "lucide-react";
import { Card, Button, Badge, Input, Field, Modal, ProgressBar } from "@/components/ui";
import { fetchPublicMenu, placePublicOrder, placePublicReservation, type PublicMenu } from "@/lib/api/public";
import { publicLoyaltySummary, publicLoyaltyClaim, publicLoyaltyRedeem, type LoyaltySummary } from "@/lib/api/loyalty";
import type { LoyaltyActionType } from "@/lib/api/database.types";
import { currencyFormatter } from "@/lib/calc";
import { cn, errorMessage, fmtNumber } from "@/lib/utils";
import { toast } from "@/lib/toast";

export default function Storefront({
  slug,
  tableName,
  initialMenu = null,
}: {
  slug: string;
  tableName: string | null;
  initialMenu?: PublicMenu | null;
}) {
  const menuQ = useQuery({
    queryKey: ["public-menu", slug],
    queryFn: () => fetchPublicMenu(slug),
    initialData: initialMenu ?? undefined,
  });
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [guestName, setGuestName] = useState("");
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

  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  const [loyaltyEmail, setLoyaltyEmail] = useState("");
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<{ code: string; reward: string } | null>(null);

  const loyaltyQ = useQuery({
    queryKey: ["public-loyalty", slug, activeEmail],
    queryFn: () => publicLoyaltySummary(slug, activeEmail ?? undefined),
    enabled: loyaltyOpen,
  });

  const menu = menuQ.data;
  const fmt = useMemo(() => currencyFormatter(menu?.org.currency ?? "USD"), [menu?.org.currency]);

  const categories = useMemo(() => {
    if (!menu) return [];
    return [...new Set(menu.recipes.map((r) => r.category))];
  }, [menu]);

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

  // Handle the redirect back from Stripe-hosted checkout (?paid / ?cancelled).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paid = params.get("paid");
    const cancelled = params.get("cancelled");
    if (paid) {
      setConfirmation({ order_number: paid, paid: true });
    } else if (cancelled) {
      toast.error("Payment cancelled", `Order ${cancelled} is unpaid — you can pay at the counter.`);
    }
    if (paid || cancelled) {
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
        { email: activeEmail, code: voucher?.code ?? null },
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
      if (data.kind === "redirect") {
        window.location.href = data.url; // hand off to Stripe-hosted checkout
        return;
      }
      setConfirmation(data.result);
      if (activeEmail) loyaltyQ.refetch();
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
      <header className="border-b border-line">
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
            <Button variant="ghost" onClick={() => setLoyaltyOpen(true)}>
              <Gift className="h-4 w-4" /> Rewards
            </Button>
          </div>
        </div>
      </header>

      {/* Menu */}
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 font-display text-lg font-bold text-white">{cat}</h2>
            <div className="space-y-2.5">
              {menu.recipes
                .filter((r) => r.category === cat)
                .map((r) => {
                  const qty = cart.get(r.id) ?? 0;
                  return (
                    <Card key={r.id} className={cn("flex items-center gap-3 p-3", qty > 0 && "border-brand-400/40")}>
                      {r.image_url ? (
                        <img src={r.image_url} alt={r.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/[0.03] text-2xl">
                          {r.emoji}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white">{r.name}</p>
                        <p className="text-sm font-bold text-brand-300">{fmt(r.price, 2)}</p>
                      </div>
                      {qty === 0 ? (
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
              <Input placeholder="Note for the kitchen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
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

      {/* Loyalty / rewards */}
      <Modal open={loyaltyOpen} onClose={() => setLoyaltyOpen(false)} title={`${menu.org.name} Rewards`} wide>
        <LoyaltyPanel
          slug={slug}
          summary={loyaltyQ.data}
          loading={loyaltyQ.isFetching}
          email={loyaltyEmail}
          setEmail={setLoyaltyEmail}
          activeEmail={activeEmail}
          onLookup={() => setActiveEmail(loyaltyEmail.trim().toLowerCase() || null)}
          onChanged={() => loyaltyQ.refetch()}
          onRedeemed={(code, reward) => {
            setVoucher({ code, reward });
            setLoyaltyOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

function LoyaltyPanel({
  slug, summary, loading, email, setEmail, activeEmail, onLookup, onChanged, onRedeemed,
}: {
  slug: string;
  summary: LoyaltySummary | undefined;
  loading: boolean;
  email: string;
  setEmail: (v: string) => void;
  activeEmail: string | null;
  onLookup: () => void;
  onChanged: () => void;
  onRedeemed: (code: string, reward: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!summary && loading) return <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>;
  if (summary && !summary.enabled) return <p className="py-8 text-center text-sm text-zinc-500">This restaurant hasn't set up rewards yet.</p>;

  const cust = summary?.customer ?? null;
  const next = summary?.next_tier ?? null;
  const pointsName = summary?.points_name ?? "points";
  const progress = next && next.threshold > 0 ? Math.min(100, ((cust?.status_points ?? 0) / next.threshold) * 100) : 100;

  const claim = async (action: LoyaltyActionType) => {
    if (!activeEmail) { toast.error("Enter your email first", ""); return; }
    setBusy(action);
    try {
      const res = await publicLoyaltyClaim(slug, activeEmail, cust?.name ?? "", action);
      if (res.status === "ok") toast.success(`+${res.awarded} ${pointsName}!`, "");
      else if (res.status === "already_claimed") toast.error("Already claimed", "You've earned this one before");
      else if (res.status === "pending_verification") toast.success("Submitted", "Points land once verified");
      else toast.error("Nothing to claim", "");
      onChanged();
    } catch (e) { toast.error("Could not claim", errorMessage(e)); }
    finally { setBusy(null); }
  };

  const redeem = async (id: string, label: string) => {
    if (!activeEmail) { toast.error("Enter your email first", ""); return; }
    setBusy(id);
    try {
      const res = await publicLoyaltyRedeem(slug, activeEmail, id);
      toast.success("Reward unlocked!", `Code ${res.code} — applied at checkout`);
      onRedeemed(res.code, label);
    } catch (e) { toast.error("Could not redeem", errorMessage(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      {/* Email lookup */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLookup()}
        />
        <Button onClick={onLookup} disabled={loading}>{loading ? "…" : "View my rewards"}</Button>
      </div>

      {/* Balance + tier */}
      {cust && (
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-400">Hi {cust.name}, you have</p>
              <p className="font-display text-3xl font-bold text-white">{fmtNumber(cust.points)} <span className="text-base text-brand-300">{pointsName}</span></p>
            </div>
            <Badge tone="amber"><Award className="h-3.5 w-3.5" /> {cust.tier}</Badge>
          </div>
          {next && (
            <div>
              <ProgressBar value={progress} tone="cyan" />
              <p className="mt-1.5 text-xs text-zinc-500">{Math.max(0, next.threshold - (cust.status_points ?? 0))} {pointsName} to {next.name}</p>
            </div>
          )}
        </Card>
      )}

      {/* Ways to earn */}
      {summary && summary.earn_rules.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4 text-brand-300" /> Ways to earn</p>
          <div className="space-y-2">
            {summary.earn_rules.map((r) => (
              <div key={r.action_type} className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{r.label}</p>
                  {r.description && <p className="truncate text-xs text-zinc-500">{r.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.points > 0 && <Badge tone="green">+{r.points}</Badge>}
                  {r.action_type === "purchase" ? (
                    <span className="text-xs text-zinc-500">automatic</span>
                  ) : ["newsletter", "instagram_follow", "review", "referral"].includes(r.action_type) ? (
                    <Button variant="ghost" onClick={() => claim(r.action_type)} disabled={busy === r.action_type || !activeEmail}>
                      {busy === r.action_type ? "…" : "Claim"}
                    </Button>
                  ) : (
                    <span className="text-xs text-zinc-500">automatic</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rewards */}
      {summary && summary.rewards.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Gift className="h-4 w-4 text-brand-300" /> Redeem your {pointsName}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.rewards.map((r) => {
              const canAfford = (cust?.points ?? 0) >= r.cost_points;
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{r.label}</p>
                    <p className="text-xs text-brand-300">{fmtNumber(r.cost_points)} {pointsName}</p>
                  </div>
                  <Button variant={canAfford ? "primary" : "ghost"} onClick={() => redeem(r.id, r.label)} disabled={busy === r.id || !activeEmail || !canAfford}>
                    {busy === r.id ? "…" : "Redeem"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!activeEmail && (
        <p className="text-center text-xs text-zinc-500">Enter your email to see your balance, claim points and redeem rewards.</p>
      )}
    </div>
  );
}
