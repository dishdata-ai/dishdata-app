"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Plus, Minus, ArrowLeft, ArrowDown, Check, PartyPopper, Sparkles, UtensilsCrossed, X, Trash2, Loader2,
} from "lucide-react";
import { fetchPublicMenu, placeCateringInquiry, type PublicMenu } from "@/lib/api/public";
import { currencyFormatter } from "@/lib/calc";
import { orderCategories } from "@/lib/category-order";
import { cn, errorMessage } from "@/lib/utils";
import type { CateringInquiryItem, CateringTier, Recipe } from "@/lib/api/database.types";

// Same symbols as the recipe editor's dietary toggle and the printed menu sheet.
const DIET_SYMBOL: Record<"veg" | "vegan", string> = { veg: "🟢", vegan: "🌱" };

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

/**
 * How far along the tier ladder to draw the fill, 0–100.
 *
 * Segment-by-segment rather than `subtotal / topTier`: tiers are spaced
 * however a restaurant likes them, and a €50 / €1000 / €2000 ladder drawn to
 * true scale crushes the first node against the left edge. Nodes sit evenly
 * and the bar fills evenly between them, so "one more node to go" always
 * looks like the same distance.
 */
function ladderFillPct(subtotal: number, tiers: CateringTier[]): number {
  if (!tiers.length) return 0;
  const segment = 100 / tiers.length;
  for (let i = 0; i < tiers.length; i++) {
    if (subtotal < tiers[i].minSpend) {
      const floor = i === 0 ? 0 : tiers[i - 1].minSpend;
      const span = tiers[i].minSpend - floor;
      const within = span > 0 ? (subtotal - floor) / span : 0;
      return (i + Math.max(0, Math.min(1, within))) * segment;
    }
  }
  return 100;
}

/** Reveals `[data-reveal]` elements as they scroll in; no-op under reduced motion. */
function useScrollReveal(deps: unknown[]) {
  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)");
    if (prefersReducedMotion()) {
      nodes.forEach((el) => el.classList.add("is-revealed"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.04 },
    );
    nodes.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Keeps Tab inside an open dialog and hands focus back to whatever opened it.
 * Without this a keyboard or screen-reader visitor tabs straight out of the
 * dialog into the menu behind it, which is still rendered and still focusable.
 */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(selector) ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, onClose, ref]);
}

type Strings = ReturnType<typeof strings>;

function strings(lang: "en" | "de") {
  return lang === "de"
    ? {
        eyebrow: "Catering",
        blurb:
          "Stellen Sie Ihr Menü zusammen, sehen Sie die Summe live und senden Sie uns die Anfrage — wir bestätigen Termin, Gästezahl und das endgültige Angebot.",
        browse: "Zur Speisekarte",
        back: "Zurück zur Karte",
        dishes: "Gerichte",
        vegOptions: "vegane & vegetarische Optionen",
        savings: "Mengenrabatt",
        yourSelection: "Ihre Auswahl",
        empty: "Noch nichts ausgewählt. Tippen Sie auf + bei den Gerichten, die Sie servieren möchten.",
        request: "Catering anfragen",
        subtotal: "Zwischensumme",
        discount: "Rabatt",
        total: "Gesamt",
        items: (n: number) => (n === 1 ? "1 Position" : `${n} Positionen`),
        addMoreLine: (amount: string, pct: number) => `Noch ${amount} bis ${pct}% Rabatt`,
        unlockedLine: (pct: number) => `${pct}% Rabatt freigeschaltet`,
        best: "Bester Rabatt freigeschaltet",
        startSaving: "Rabatte ab der ersten Stufe",
        off: "Rabatt",
        yourEvent: "Ihre Veranstaltung",
        eventHint: "Wir melden uns telefonisch oder per E-Mail, um alles zu bestätigen.",
        name: "Ihr Name",
        phone: "Telefon",
        email: "E-Mail (optional)",
        date: "Veranstaltungsdatum (optional)",
        headcount: "Anzahl Gäste (optional)",
        notes: "Anmerkungen (optional)",
        notesPlaceholder: "Allergien, Lieferadresse, Uhrzeit …",
        required: "Bitte ausfüllen",
        sending: "Wird gesendet …",
        send: "Anfrage senden",
        sentTitle: "Anfrage gesendet",
        sentBody: "Vielen Dank — wir melden uns in Kürze, um Ihre Veranstaltung zu besprechen.",
        done: "Fertig",
        close: "Schließen",
        addTo: (dish: string) => `${dish} hinzufügen`,
        increase: (dish: string) => `Eine ${dish} mehr`,
        decrease: (dish: string) => `Eine ${dish} weniger`,
        removeAll: (dish: string) => `${dish} entfernen`,
        jumpTo: "Kategorien",
        skip: "Direkt zur Speisekarte",
        legend: "🟢 Vegetarisch · 🌱 Vegan",
      }
    : {
        eyebrow: "Catering",
        blurb:
          "Build your menu, watch the total as you go, and send it over — we'll confirm the date, headcount and final quote.",
        browse: "Browse the menu",
        back: "Back to menu",
        dishes: "dishes",
        vegOptions: "vegan & vegetarian options",
        savings: "Volume savings",
        yourSelection: "Your selection",
        empty: "Nothing picked yet. Tap + on the dishes you'd like to serve.",
        request: "Request catering",
        subtotal: "Subtotal",
        discount: "Discount",
        total: "Total",
        items: (n: number) => (n === 1 ? "1 item" : `${n} items`),
        addMoreLine: (amount: string, pct: number) => `${amount} more to unlock ${pct}% off`,
        unlockedLine: (pct: number) => `${pct}% off unlocked`,
        best: "Best discount unlocked",
        startSaving: "Savings start at the first tier",
        off: "off",
        yourEvent: "Your event",
        eventHint: "We'll call or email you to confirm the details.",
        name: "Your name",
        phone: "Phone",
        email: "Email (optional)",
        date: "Event date (optional)",
        headcount: "Number of guests (optional)",
        notes: "Notes (optional)",
        notesPlaceholder: "Allergies, delivery address, serving time…",
        required: "Please fill this in",
        sending: "Sending…",
        send: "Send request",
        sentTitle: "Request sent",
        sentBody: "Thank you — we'll be in touch shortly to talk through your event.",
        done: "Done",
        close: "Close",
        addTo: (dish: string) => `Add ${dish}`,
        increase: (dish: string) => `One more ${dish}`,
        decrease: (dish: string) => `One fewer ${dish}`,
        removeAll: (dish: string) => `Remove ${dish}`,
        jumpTo: "Categories",
        skip: "Skip to the menu",
        legend: "🟢 Vegetarian · 🌱 Vegan",
      };
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
  const pick = useCallback(
    (de: string | null, en: string) => (lang === "de" && de ? de : en),
    [lang],
  );
  const t = useMemo(() => strings(lang), [lang]);

  const [picks, setPicks] = useState<Map<string, number>>(new Map());
  const setQty = useCallback((id: string, qty: number) => {
    setPicks((prev) => {
      const next = new Map(prev);
      if (qty <= 0) next.delete(id);
      else next.set(id, Math.min(qty, 999));
      return next;
    });
  }, []);

  const categories = useMemo(() => {
    if (!menu) return [];
    const present = [...new Set(menu.recipes.map((r) => r.category))];
    return orderCategories(present, menu.org.category_order);
  }, [menu]);

  // Grouping keys off the English category; this only resolves the label to
  // show, upgrading from the English fallback as soon as any recipe in the
  // category supplies a translation (same rule as the storefront and sheet).
  const categoryDisplay = useMemo(() => {
    const map = new Map<string, string>();
    if (!menu) return map;
    for (const r of menu.recipes) {
      if (!map.has(r.category) || (lang === "de" && r.category_de && map.get(r.category) === r.category)) {
        map.set(r.category, pick(r.category_de, r.category));
      }
    }
    return map;
  }, [menu, lang, pick]);

  const byCategory = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of menu?.recipes ?? []) {
      const list = map.get(r.category);
      if (list) list.push(r);
      else map.set(r.category, [r]);
    }
    return map;
  }, [menu]);

  const lines = useMemo(() => {
    if (!menu) return [];
    return [...picks.entries()]
      .map(([id, qty]) => ({ recipe: menu.recipes.find((r) => r.id === id), qty }))
      .filter((l): l is { recipe: Recipe; qty: number } => !!l.recipe);
  }, [picks, menu]);
  const subtotal = lines.reduce((s, l) => s + l.recipe.price * l.qty, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);

  const tiers = menu?.org.catering_tiers ?? [];
  const { active, next, sorted } = tierProgress(subtotal, tiers);
  const discountPct = active?.discountPct ?? 0;
  const discountValue = subtotal * (discountPct / 100);
  const total = subtotal - discountValue;
  const fill = ladderFillPct(subtotal, sorted);

  // Celebrate crossing a threshold, once, on the way up only.
  const [celebrating, setCelebrating] = useState(false);
  const prevTier = useRef<number>(0);
  useEffect(() => {
    if (discountPct > prevTier.current) {
      setCelebrating(true);
      const id = setTimeout(() => setCelebrating(false), 2600);
      prevTier.current = discountPct;
      return () => clearTimeout(id);
    }
    prevTier.current = discountPct;
  }, [discountPct]);

  // One debounced announcement rather than one per tap — a screen reader
  // reading every keystroke of a quantity stepper is unusable.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const id = setTimeout(() => {
      if (!itemCount) return setAnnouncement("");
      const hint = next
        ? t.addMoreLine(fmt(Math.max(0, next.minSpend - subtotal), 0), next.discountPct)
        : active
          ? t.best
          : "";
      setAnnouncement(`${t.items(lines.length)}, ${fmt(total, 2)}. ${hint}`);
    }, 500);
    return () => clearTimeout(id);
  }, [itemCount, subtotal, total, next, active, lines.length, fmt, t]);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryId = (cat: string) => `cat-${cat.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const scrollToCategory = (cat: string) => {
    setActiveCategory(cat);
    document.getElementById(categoryId(cat))?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  useEffect(() => {
    if (!categories.length) return;
    const labelById = new Map(categories.map((c) => [categoryId(c), c]));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const label = visible[0] && labelById.get(visible[0].target.id);
        if (label) setActiveCategory(label);
      },
      { rootMargin: "-120px 0px -70% 0px" },
    );
    categories
      .map((c) => document.getElementById(categoryId(c)))
      .filter((el): el is HTMLElement => !!el)
      .forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [categories]);

  useScrollReveal([menu, categories.length, lang]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", date: "", headcount: "", notes: "" });
  const [touched, setTouched] = useState(false);

  const submit = useMutation({
    mutationFn: async () => {
      const items: CateringInquiryItem[] = lines.map((l) => ({
        recipe_id: l.recipe.id,
        name: pick(l.recipe.name_de, l.recipe.name),
        qty: l.qty,
        unit_price: l.recipe.price,
      }));
      await placeCateringInquiry(slug, {
        guestName: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        eventDate: form.date || null,
        headcount: form.headcount ? Math.max(1, +form.headcount) : null,
        notes: form.notes.trim() || null,
        items,
        subtotal,
        discountPct,
      });
    },
    onSuccess: () => {
      setSent(true);
      setPicks(new Map());
      setTouched(false);
      prevTier.current = 0;
    },
  });

  const closeForm = useCallback(() => {
    if (submit.isPending) return;
    setFormOpen(false);
    submit.reset();
  }, [submit]);

  const openForm = () => {
    setSheetOpen(false);
    setTouched(false);
    setFormOpen(true);
  };

  if (menuQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-400" aria-label="Loading" />
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

  const vegCount = menu.recipes.filter((r) => r.diet === "veg" || r.diet === "vegan").length;

  return (
    <div className="min-h-screen">
      <a
        href="#menu"
        className="sr-only rounded-xl bg-brand-400 px-4 py-2 font-semibold text-zinc-950 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60]"
      >
        {t.skip}
      </a>

      {/* Announcements for assistive tech — the visible totals update silently. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      {/* ---------------------------------------------------------------- Hero */}
      <header className="relative isolate overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-70"
          style={{
            backgroundImage:
              "radial-gradient(60rem 30rem at 20% -20%, rgba(16,185,129,0.22), transparent 60%), radial-gradient(45rem 25rem at 90% 0%, rgba(34,211,238,0.18), transparent 55%)",
          }}
        />
        <div className="absolute top-3 right-3 flex items-center gap-0.5 rounded-full border border-line bg-black/30 p-0.5 backdrop-blur">
          {(["en", "de"] as const).map((code) => (
            <button
              key={code}
              onClick={() => changeLang(code)}
              aria-pressed={lang === code}
              className={cn(
                "min-h-[36px] cursor-pointer rounded-full px-3 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                lang === code ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white",
              )}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:py-20">
          <div className="flex flex-col items-center gap-5 text-center lg:items-start lg:text-left">
            {menu.org.logo_url ? (
              <img
                src={menu.org.logo_url}
                alt=""
                className="h-16 w-16 rounded-2xl object-cover ring-1 ring-white/15 sm:h-20 sm:w-20"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-400 sm:h-20 sm:w-20">
                <span className="font-display text-3xl font-bold text-zinc-950">{menu.org.name[0]}</span>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold tracking-[0.25em] text-brand-300 uppercase">{t.eyebrow}</p>
              <h1 className="mt-2 font-display text-4xl font-bold text-balance text-white sm:text-5xl lg:text-6xl">
                {menu.org.name}
              </h1>
            </div>
            <p className="max-w-xl text-base text-pretty text-zinc-400">{t.blurb}</p>

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-zinc-500 lg:justify-start">
              <span>{menu.recipes.length} {t.dishes}</span>
              {vegCount > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{vegCount} {t.vegOptions}</span>
                </>
              )}
              {sorted.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t.savings} {fmt(sorted[0].minSpend, 0)}+</span>
                </>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <a
                href="#menu"
                className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 px-6 text-sm font-semibold text-zinc-950 shadow-lg shadow-brand-500/20 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
              >
                {t.browse} <ArrowDown className="h-4 w-4" />
              </a>
              <Link
                href={`/r/${slug}`}
                className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.03] px-5 text-sm font-semibold text-zinc-300 transition-all hover:border-zinc-500 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
              >
                <ArrowLeft className="h-4 w-4" /> {t.back}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------ Sticky category rail */}
      {categories.length > 1 && (
        <nav
          aria-label={t.jumpTo}
          className="sticky top-0 z-30 border-b border-line bg-base/85 backdrop-blur-xl"
        >
          <ul className="mx-auto flex max-w-7xl snap-x gap-1.5 overflow-x-auto px-4 py-2.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((cat) => {
              const current = activeCategory === cat;
              return (
                <li key={cat} className="snap-start">
                  <button
                    onClick={() => scrollToCategory(cat)}
                    aria-current={current ? "true" : undefined}
                    className={cn(
                      "min-h-[38px] shrink-0 cursor-pointer rounded-full px-3.5 text-xs font-semibold whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none",
                      current
                        ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                        : "border border-line bg-white/[0.03] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200",
                    )}
                  >
                    {categoryDisplay.get(cat) ?? cat}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* --------------------------------------------------------------- Body */}
      <div className="mx-auto max-w-7xl gap-10 px-4 pt-8 pb-40 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-16">
        {/* @container, not viewport breakpoints: the menu column is ~340px
            narrower than the page whenever the summary sidebar is showing,
            so a viewport-based two-column rule splits these cards while
            they're still too narrow for a dish name and a price. */}
        <main id="menu" className="@container scroll-mt-20">
          <TierLadder
            t={t}
            fmt={fmt}
            tiers={sorted}
            subtotal={subtotal}
            active={active}
            next={next}
            fill={fill}
            celebrating={celebrating}
          />

          {vegCount > 0 && <p className="mt-4 text-xs text-zinc-500">{t.legend}</p>}

          {categories.map((cat) => (
            <section key={cat} id={categoryId(cat)} className="mt-10 scroll-mt-24 first:mt-8">
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">
                {categoryDisplay.get(cat) ?? cat}
              </h2>
              <ul className="mt-4 grid gap-3 @3xl:grid-cols-2">
                {(byCategory.get(cat) ?? []).map((r, i) => (
                  <li
                    key={r.id}
                    data-reveal
                    style={{ transitionDelay: `${Math.min(i, 6) * 45}ms` }}
                  >
                    <DishCard
                      recipe={r}
                      qty={picks.get(r.id) ?? 0}
                      name={pick(r.name_de, r.name)}
                      description={pick(r.description_de, r.description ?? "") || null}
                      fmt={fmt}
                      t={t}
                      setQty={setQty}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </main>

        {/* Desktop summary — always visible, so the running total and the next
            reward stay in view while scrolling a long menu. */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <SummaryPanel
              t={t}
              fmt={fmt}
              lines={lines}
              subtotal={subtotal}
              discountPct={discountPct}
              discountValue={discountValue}
              total={total}
              setQty={setQty}
              onRequest={openForm}
              pick={pick}
            />
          </div>
        </aside>
      </div>

      {/* --------------------------------------------- Mobile summary bar/sheet */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
            <button
              onClick={() => setSheetOpen(true)}
              className="min-h-[48px] flex-1 cursor-pointer rounded-xl border border-line bg-white/[0.03] px-4 text-left transition-all hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
            >
              <span className="block text-[11px] text-zinc-500">{t.items(lines.length)}</span>
              <span className="flex items-baseline gap-2">
                {discountPct > 0 && (
                  <span className="text-xs text-zinc-500 line-through">{fmt(subtotal, 2)}</span>
                )}
                <span className="text-base font-bold text-white">{fmt(total, 2)}</span>
              </span>
            </button>
            <button
              onClick={openForm}
              className="min-h-[48px] cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 px-5 text-sm font-bold text-zinc-950 shadow-lg shadow-brand-500/20 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
            >
              {t.request}
            </button>
          </div>
        </div>
      )}

      {sheetOpen && (
        <Sheet titleId="catering-sheet-title" onClose={() => setSheetOpen(false)} label={t.yourSelection}>
          <SummaryPanel
            t={t}
            fmt={fmt}
            lines={lines}
            subtotal={subtotal}
            discountPct={discountPct}
            discountValue={discountValue}
            total={total}
            setQty={setQty}
            onRequest={openForm}
            pick={pick}
            titleId="catering-sheet-title"
            onClose={() => setSheetOpen(false)}
          />
        </Sheet>
      )}

      {/* ------------------------------------------------------- Request dialog */}
      {formOpen && (
        <Sheet titleId="catering-form-title" onClose={closeForm} label={t.yourEvent}>
          {sent ? (
            <div className="px-5 py-8 text-center sm:px-6">
              <PartyPopper className="mx-auto h-12 w-12 text-brand-400" aria-hidden />
              <h2 id="catering-form-title" className="mt-4 font-display text-xl font-bold text-white">
                {t.sentTitle}
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">{t.sentBody}</p>
              <button
                onClick={() => {
                  setSent(false);
                  setFormOpen(false);
                  setForm({ name: "", phone: "", email: "", date: "", headcount: "", notes: "" });
                }}
                className="mt-6 min-h-[48px] w-full cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 text-sm font-bold text-zinc-950 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
              >
                {t.done}
              </button>
            </div>
          ) : (
            <RequestForm
              t={t}
              fmt={fmt}
              form={form}
              setForm={setForm}
              touched={touched}
              setTouched={setTouched}
              lines={lines}
              total={total}
              pending={submit.isPending}
              error={submit.isError ? errorMessage(submit.error) : null}
              onSubmit={() => submit.mutate()}
              onClose={closeForm}
              titleId="catering-form-title"
            />
          )}
        </Sheet>
      )}

      <footer className="mx-auto max-w-7xl px-4 pb-10 text-center lg:pb-14">
        <p className="text-xs text-zinc-600">
          Powered by Dish<span className="text-gradient font-semibold">Data</span>
        </p>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TierLadder({
  t, fmt, tiers, subtotal, active, next, fill, celebrating,
}: {
  t: Strings;
  fmt: (v: number, d?: number) => string;
  tiers: CateringTier[];
  subtotal: number;
  active: CateringTier | null;
  next: CateringTier | null;
  fill: number;
  celebrating: boolean;
}) {
  if (!tiers.length) return null;
  return (
    <section
      aria-label={t.savings}
      className={cn(
        "glass rounded-2xl p-5 transition-shadow sm:p-6",
        celebrating && "shadow-[0_0_40px_-8px] shadow-brand-500/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles
          className={cn("h-4 w-4 text-accent-400", celebrating && "animate-tier-pop")}
          aria-hidden
        />
        <h2 className="text-sm font-semibold text-white">
          {active ? t.unlockedLine(active.discountPct) : t.startSaving}
        </h2>
      </div>

      <p className="mt-1 text-sm text-zinc-400">
        {next
          ? t.addMoreLine(fmt(Math.max(0, next.minSpend - subtotal), 0), next.discountPct)
          : active
            ? t.best
            : ""}
      </p>

      {/* A bar plus a row of chips, rather than labels pinned along the bar:
          tier labels are variable-width and the last one sits at 100%, so
          pinned labels clip off the card edge on a phone. */}
      <div
        className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill)}
        aria-label={t.savings}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-400 transition-[width] duration-700 ease-out"
          style={{ width: `${fill}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-wrap gap-2">
        {tiers.map((tier, i) => {
          const unlocked = subtotal >= tier.minSpend;
          const isCurrent = active?.minSpend === tier.minSpend;
          return (
            <li
              key={`${tier.minSpend}-${i}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors duration-500",
                unlocked
                  ? "border-brand-400/50 bg-brand-400/10 text-brand-300"
                  : "border-line text-zinc-500",
                celebrating && isCurrent && "animate-tier-pop",
              )}
            >
              {unlocked && <Check className="h-3 w-3 shrink-0" aria-hidden />}
              <span>
                {fmt(tier.minSpend, 0)}+ → {tier.discountPct}% {t.off}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DishCard({
  recipe, qty, name, description, fmt, t, setQty,
}: {
  recipe: Recipe;
  qty: number;
  name: string;
  description: string | null;
  fmt: (v: number, d?: number) => string;
  t: Strings;
  setQty: (id: string, qty: number) => void;
}) {
  const selected = qty > 0;
  return (
    <div
      className={cn(
        "group flex h-full items-start gap-3.5 rounded-2xl border p-3.5 transition-all duration-200",
        selected
          ? "border-brand-400/50 bg-brand-400/[0.06] shadow-lg shadow-brand-500/10"
          : "border-line bg-white/[0.02] hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-white/[0.04]",
      )}
    >
      {recipe.image_url ? (
        <img
          src={recipe.image_url}
          alt=""
          loading="lazy"
          className="h-[72px] w-[72px] shrink-0 rounded-xl object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] text-3xl"
        >
          {recipe.emoji}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-balance text-white">
          {recipe.diet && (
            <span className="mr-1" title={recipe.diet === "vegan" ? "Vegan" : "Vegetarian"}>
              {DIET_SYMBOL[recipe.diet]}
            </span>
          )}
          {name}
        </h3>
        {description && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{description}</p>
        )}
        <p className="mt-2 text-sm font-bold text-brand-300">{fmt(recipe.price, 2)}</p>
      </div>

      {selected ? (
        <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-base/60 p-1">
          <button
            onClick={() => setQty(recipe.id, qty - 1)}
            aria-label={qty === 1 ? t.removeAll(name) : t.decrease(name)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            {qty === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
          <span aria-live="off" className="w-6 text-center text-sm font-bold text-white tabular-nums">
            {qty}
          </span>
          <button
            onClick={() => setQty(recipe.id, qty + 1)}
            aria-label={t.increase(name)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setQty(recipe.id, 1)}
          aria-label={t.addTo(name)}
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-90"
        >
          <Plus className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function SummaryPanel({
  t, fmt, lines, subtotal, discountPct, discountValue, total, setQty, onRequest, pick, titleId, onClose,
}: {
  t: Strings;
  fmt: (v: number, d?: number) => string;
  lines: { recipe: Recipe; qty: number }[];
  subtotal: number;
  discountPct: number;
  discountValue: number;
  total: number;
  setQty: (id: string, qty: number) => void;
  onRequest: () => void;
  pick: (de: string | null, en: string) => string;
  titleId?: string;
  onClose?: () => void;
}) {
  return (
    <div className="glass rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <h2 id={titleId} className="font-display text-base font-bold text-white">
          {t.yourSelection}
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t.close}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {lines.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-zinc-500">{t.empty}</p>
      ) : (
        <>
          <ul className="max-h-[38vh] divide-y divide-white/[0.05] overflow-y-auto px-5 lg:max-h-[42vh]">
            {lines.map(({ recipe, qty }) => {
              const name = pick(recipe.name_de, recipe.name);
              return (
                <li key={recipe.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{name}</p>
                    <p className="text-xs text-zinc-500">{fmt(recipe.price, 2)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setQty(recipe.id, qty - 1)}
                      aria-label={qty === 1 ? t.removeAll(name) : t.decrease(name)}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
                    >
                      {qty === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                    </button>
                    <span className="w-5 text-center text-sm font-bold text-white">{qty}</span>
                    <button
                      onClick={() => setQty(recipe.id, qty + 1)}
                      aria-label={t.increase(name)}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm font-semibold text-zinc-200">
                    {fmt(recipe.price * qty, 2)}
                  </span>
                </li>
              );
            })}
          </ul>

          <dl className="space-y-1.5 border-t border-white/[0.06] px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">{t.subtotal}</dt>
              <dd className="text-zinc-200">{fmt(subtotal, 2)}</dd>
            </div>
            {discountPct > 0 && (
              <div className="flex justify-between">
                <dt className="text-brand-300">{t.discount} · {discountPct}%</dt>
                <dd className="text-brand-300">−{fmt(discountValue, 2)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-1.5">
              <dt className="font-semibold text-white">{t.total}</dt>
              <dd className="font-display text-xl font-bold text-white">{fmt(total, 2)}</dd>
            </div>
          </dl>

          <div className="px-5 pb-5">
            <button
              onClick={onRequest}
              className="min-h-[48px] w-full cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 text-sm font-bold text-zinc-950 shadow-lg shadow-brand-500/20 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98]"
            >
              {t.request}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centred dialog from `sm` up. */
function Sheet({
  children, onClose, label, titleId,
}: {
  children: React.ReactNode;
  onClose: () => void;
  label: string;
  titleId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="animate-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={titleId}
        className="animate-sheet-up relative max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl sm:animate-rise sm:max-w-md sm:rounded-2xl"
      >
        {children}
      </div>
    </div>
  );
}

function RequestForm({
  t, fmt, form, setForm, touched, setTouched, lines, total, pending, error, onSubmit, onClose, titleId,
}: {
  t: Strings;
  fmt: (v: number, d?: number) => string;
  form: { name: string; phone: string; email: string; date: string; headcount: string; notes: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; phone: string; email: string; date: string; headcount: string; notes: string }>>;
  touched: boolean;
  setTouched: (v: boolean) => void;
  lines: { recipe: Recipe; qty: number }[];
  total: number;
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
  titleId: string;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameBad = touched && !form.name.trim();
  const phoneBad = touched && !form.phone.trim();

  // Validate on submit and move focus to the first problem, rather than
  // disabling the button — a disabled control gives a keyboard or screen
  // reader user nothing to act on and no reason why.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!form.name.trim()) return nameRef.current?.focus();
    if (!form.phone.trim()) return phoneRef.current?.focus();
    onSubmit();
  };

  const field =
    "min-h-[48px] w-full rounded-xl border bg-base/60 px-3.5 text-sm text-zinc-100 transition-colors placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <h2 id={titleId} className="font-display text-base font-bold text-white">{t.yourEvent}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:outline-none"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-3 px-5 py-4">
        <p className="text-xs text-zinc-500">{t.eventHint}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t.name} <span className="text-rose-soft">*</span>
            </span>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              aria-required="true"
              aria-invalid={nameBad || undefined}
              aria-describedby={nameBad ? "catering-name-err" : undefined}
              className={cn(field, nameBad ? "border-rose-soft" : "border-line")}
            />
            {nameBad && (
              <span id="catering-name-err" className="mt-1 block text-xs text-rose-soft">{t.required}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">
              {t.phone} <span className="text-rose-soft">*</span>
            </span>
            <input
              ref={phoneRef}
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              required
              aria-required="true"
              aria-invalid={phoneBad || undefined}
              aria-describedby={phoneBad ? "catering-phone-err" : undefined}
              className={cn(field, phoneBad ? "border-rose-soft" : "border-line")}
            />
            {phoneBad && (
              <span id="catering-phone-err" className="mt-1 block text-xs text-rose-soft">{t.required}</span>
            )}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">{t.email}</span>
            <input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className={cn(field, "border-line")}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">{t.date}</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className={cn(field, "border-line")}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">{t.headcount}</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={form.headcount}
              onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))}
              className={cn(field, "border-line")}
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-zinc-400">{t.notes}</span>
            <textarea
              rows={3}
              value={form.notes}
              placeholder={t.notesPlaceholder}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className={cn(field, "resize-none border-line py-2.5")}
            />
          </label>
        </div>

        <div className="flex items-baseline justify-between rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-sm">
          <span className="text-zinc-400">{t.items(lines.length)}</span>
          <span className="font-semibold text-white">{fmt(total, 2)}</span>
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-rose-soft/20 bg-rose-soft/5 p-3 text-xs text-rose-soft">
            {error}
          </p>
        )}
      </div>

      <div className="px-5 pb-5">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 text-sm font-bold text-zinc-950 shadow-lg shadow-brand-500/20 transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t.sending}
            </>
          ) : (
            <>
              <Check className="h-4 w-4" aria-hidden /> {t.send}
            </>
          )}
        </button>
      </div>
    </form>
  );
}
