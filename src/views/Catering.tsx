"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Minus, CircleDot, CheckCircle2, UtensilsCrossed, ArrowLeft, PartyPopper, Sparkles } from "lucide-react";
import { Card, Button, Badge, Input, Field, Modal, Textarea } from "@/components/ui";
import { fetchPublicMenu, placeCateringInquiry, type PublicMenu } from "@/lib/api/public";
import { currencyFormatter } from "@/lib/calc";
import { orderCategories } from "@/lib/category-order";
import { cn, errorMessage } from "@/lib/utils";
import type { CateringInquiryItem, CateringTier } from "@/lib/api/database.types";

// Same symbols as the recipe editor's dietary toggle and the printed menu sheet.
const DIET_SYMBOL: Record<"veg" | "vegan", string> = { veg: "🟢", vegan: "🌱" };

/** Which tier the current subtotal has unlocked, and the next one to reach for. */
function tierProgress(subtotal: number, tiers: CateringTier[]) {
  const sorted = [...tiers].sort((a, b) => a.minSpend - b.minSpend);
  let active: CateringTier | null = null;
  let next: CateringTier | null = null;
  for (const t of sorted) {
    if (subtotal >= t.minSpend) active = t;
    else if (!next) next = t;
  }
  return { active, next, sorted };
}

export default function Catering({
  slug,
  initialMenu = null,
}: {
  slug: string;
  initialMenu?: PublicMenu | null;
}) {
  const menuQ = useQuery({
    queryKey: ["public-menu", slug],
    queryFn: () => fetchPublicMenu(slug),
    initialData: initialMenu ?? undefined,
  });
  const menu = menuQ.data;
  const fmt = useMemo(() => currencyFormatter(menu?.org.currency ?? "USD"), [menu?.org.currency]);

  const [lang, setLang] = useState<"en" | "de">("en");
  useEffect(() => {
    try {
      // Shares the storefront's own remembered language — same visitor, same choice.
      const saved = localStorage.getItem("storefront-lang");
      if (saved === "de" || saved === "en") setLang(saved);
    } catch { /* private browsing, etc. — default stands */ }
  }, []);
  const changeLang = (next: "en" | "de") => {
    setLang(next);
    try { localStorage.setItem("storefront-lang", next); } catch { /* ignore */ }
  };
  const pick = (de: string | null, en: string) => (lang === "de" && de ? de : en);
  const t = lang === "de"
    ? {
        title: "Catering", blurb: "Wählen Sie Gerichte für Ihre Veranstaltung — wir melden uns, um Termin und Anzahl der Gäste zu bestätigen.",
        back: "Zur Speisekarte", request: "Catering anfragen", subtotal: "Zwischensumme", unlocked: "freigeschaltet",
        addMoreLine: (amount: string, pct: number) => `Noch ${amount} für ${pct}% Rabatt`,
        off: "Rabatt", best: "Bester Rabatt freigeschaltet!",
        yourEvent: "Ihre Veranstaltung", name: "Ihr Name", phone: "Telefon", email: "E-Mail (optional)",
        date: "Veranstaltungsdatum", headcount: "Anzahl Gäste", notes: "Anmerkungen (optional)",
        sending: "Wird gesendet…", send: "Anfrage senden", sentTitle: "Anfrage gesendet!",
        sentBody: "Vielen Dank — wir melden uns in Kürze, um Ihre Veranstaltung zu besprechen.", done: "Fertig",
        empty: "Wählen Sie Gerichte, um Ihre Catering-Anfrage zusammenzustellen.",
        unlockSavings: "Rabatte freischalten",
      }
    : {
        title: "Catering", blurb: "Pick dishes for your event — we'll follow up to confirm the date and headcount.",
        back: "Back to menu", request: "Request Catering", subtotal: "Subtotal", unlocked: "unlocked",
        addMoreLine: (amount: string, pct: number) => `Add ${amount} more for ${pct}% off`,
        off: "off", best: "Best discount unlocked!",
        yourEvent: "Your event", name: "Your name", phone: "Phone", email: "Email (optional)",
        date: "Event date", headcount: "Number of guests", notes: "Notes (optional)",
        sending: "Sending…", send: "Send request", sentTitle: "Request sent!",
        sentBody: "Thank you — we'll be in touch shortly to talk through your event.", done: "Done",
        empty: "Pick some dishes to start building your catering request.",
        unlockSavings: "Unlock catering savings",
      };

  const [picks, setPicks] = useState<Map<string, number>>(new Map());
  const setQty = (id: string, qty: number) =>
    setPicks((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, qty);
      return next;
    });

  const categories = useMemo(() => {
    if (!menu) return [];
    const present = [...new Set(menu.recipes.map((r) => r.category))];
    return orderCategories(present, menu.org.category_order);
  }, [menu]);

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

  const lines = useMemo(() => {
    if (!menu) return [];
    return [...picks.entries()]
      .map(([id, qty]) => ({ recipe: menu.recipes.find((r) => r.id === id), qty }))
      .filter((l) => l.recipe);
  }, [picks, menu]);
  const subtotal = lines.reduce((s, l) => s + l.recipe!.price * l.qty, 0);

  const { active, next, sorted: tiers } = tierProgress(subtotal, menu?.org.catering_tiers ?? []);
  const discountedTotal = subtotal * (1 - (active?.discountPct ?? 0) / 100);
  // Toward the FIRST unreached tier, from zero — not from the previous tier's
  // threshold, so the bar reads as "progress toward my next reward," which is
  // the number a customer actually watches, not an internal step size.
  const progressPct = next ? Math.min(100, Math.round((subtotal / next.minSpend) * 100)) : 100;

  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", date: "", headcount: "", notes: "" });

  const submit = useMutation({
    mutationFn: async () => {
      const items: CateringInquiryItem[] = lines.map((l) => ({
        recipe_id: l.recipe!.id, name: pick(l.recipe!.name_de, l.recipe!.name), qty: l.qty, unit_price: l.recipe!.price,
      }));
      await placeCateringInquiry(slug, {
        guestName: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || null,
        eventDate: form.date || null, headcount: form.headcount ? Math.max(1, +form.headcount) : null,
        notes: form.notes.trim() || null, items, subtotal, discountPct: active?.discountPct ?? 0,
      });
    },
    onSuccess: () => {
      setRequesting(false);
      setSent(true);
      setPicks(new Map());
      setForm({ name: "", phone: "", email: "", date: "", headcount: "", notes: "" });
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
    <div className="min-h-screen pb-36">
      {/* Hero */}
      <header className="relative border-b border-line">
        <div className="absolute top-3 right-3 flex items-center gap-0.5 rounded-full border border-line bg-white/[0.03] p-0.5">
          <button
            onClick={() => changeLang("en")}
            className={cn("cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all", lang === "en" ? "bg-white/10 text-white" : "text-zinc-500")}
          >
            EN
          </button>
          <button
            onClick={() => changeLang("de")}
            className={cn("cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-all", lang === "de" ? "bg-white/10 text-white" : "text-zinc-500")}
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
          <h1 className="font-display text-3xl font-bold text-white">
            {menu.org.name} <span className="text-zinc-500">· {t.title}</span>
          </h1>
          <p className="max-w-md text-sm text-zinc-400">{t.blurb}</p>
          <Link
            href={`/r/${slug}`}
            className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t.back}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        {/* Tier banner — always visible, not just once something's picked, so
            the incentive is the first thing a customer sees, not a surprise
            at checkout. */}
        {tiers.length > 0 && (
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent-400" />
              <span className="text-sm font-semibold text-white">
                {active ? `${active.discountPct}% ${t.unlocked}` : t.unlockSavings}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-400 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-zinc-400">
              {next
                ? t.addMoreLine(fmt(Math.max(0, next.minSpend - subtotal), 0), next.discountPct)
                : t.best}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {tiers.map((tier) => (
                <span
                  key={tier.minSpend}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    active && active.minSpend === tier.minSpend
                      ? "border-brand-400/60 bg-brand-400/10 text-brand-300"
                      : "border-line text-zinc-500",
                  )}
                >
                  {fmt(tier.minSpend, 0)}+ → {tier.discountPct}% {t.off}
                </span>
              ))}
            </div>
          </Card>
        )}

        {lines.length === 0 && <p className="text-center text-sm text-zinc-500">{t.empty}</p>}

        {menu.recipes.some((r) => r.diet === "veg" || r.diet === "vegan") && (
          <p className="-mt-2 text-xs text-zinc-500">{pick("🟢 Vegetarisch · 🌱 Vegan", "🟢 Vegetarian · 🌱 Vegan")}</p>
        )}

        {categories.map((cat) => (
          <section key={cat}>
            <h2 className="mb-3 font-display text-lg font-bold text-white">{categoryDisplay.get(cat) ?? cat}</h2>
            <div className="space-y-2.5">
              {menu.recipes
                .filter((r) => r.category === cat)
                .map((r) => {
                  const qty = picks.get(r.id) ?? 0;
                  const name = pick(r.name_de, r.name);
                  const description = pick(r.description_de, r.description ?? "") || null;
                  return (
                    <Card key={r.id} className={cn("flex items-center gap-3 p-3", qty > 0 && "border-brand-400/40")}>
                      {r.image_url ? (
                        <img src={r.image_url} alt={name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
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

      {/* Sticky request bar */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl px-4 py-4">
            <div className="mb-3 flex items-baseline justify-between text-sm">
              <span className="text-zinc-400">{t.subtotal}</span>
              <span className="font-semibold text-white">
                {active && active.discountPct > 0 ? (
                  <>
                    <span className="mr-2 text-zinc-500 line-through">{fmt(subtotal, 2)}</span>
                    {fmt(discountedTotal, 2)}
                  </>
                ) : (
                  fmt(subtotal, 2)
                )}
              </span>
            </div>
            <Button className="w-full py-3" onClick={() => setRequesting(true)}>
              {t.request}
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

      {/* Request form */}
      <Modal open={requesting} onClose={() => setRequesting(false)} title={t.yourEvent}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.name}>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
            </Field>
            <Field label={t.phone}>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label={t.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label={t.date}>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <div className="col-span-2">
              <Field label={t.headcount}>
                <Input type="number" min="1" value={form.headcount} onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))} />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label={t.notes}>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </Field>
            </div>
          </div>
          <div className="flex items-baseline justify-between rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-sm">
            <span className="text-zinc-400">{lines.length} {lang === "de" ? "Positionen" : "items"}</span>
            <span className="font-semibold text-white">{fmt(discountedTotal, 2)}</span>
          </div>
          {submit.isError && (
            <p className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs text-rose-soft">
              {errorMessage(submit.error)}
            </p>
          )}
          <Button
            className="w-full"
            disabled={!form.name.trim() || !form.phone.trim() || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? t.sending : t.send}
          </Button>
        </div>
      </Modal>

      <Modal open={sent} onClose={() => setSent(false)} title={t.sentTitle}>
        <div className="space-y-4 text-center">
          <PartyPopper className="mx-auto h-12 w-12 text-brand-400" />
          <p className="text-sm text-zinc-400">{t.sentBody}</p>
          <Button className="w-full" onClick={() => setSent(false)}>
            {t.done}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
