"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CircleDot, UtensilsCrossed } from "lucide-react";
import { fetchPublicMenu, type PublicMenu } from "@/lib/api/public";
import { publicLoyaltySummary } from "@/lib/api/loyalty";
import { LoyaltyPanel } from "@/components/loyalty/LoyaltyPanel";
import { getRememberedEmail, rememberEmail } from "@/lib/storefront-identity";

/**
 * The rewards program's own page — a shareable, bookmarkable landing spot
 * (e.g. from a QR code on the table or receipt), separate from the order
 * flow. Redeeming here hands the voucher back to the menu via a query param
 * rather than requiring the reward and the order to happen in one session.
 */
export default function Rewards({
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

  const [email, setEmail] = useState("");
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState<{ code: string; reward: string } | null>(null);

  // A returning visitor sees their balance right away instead of retyping
  // their email — a remembered convenience, not a real login (see
  // src/lib/storefront-identity.ts).
  useEffect(() => {
    const remembered = getRememberedEmail();
    if (remembered) {
      setEmail(remembered);
      setActiveEmail(remembered);
    }
  }, []);

  const loyaltyQ = useQuery({
    queryKey: ["public-loyalty", slug, activeEmail],
    queryFn: () => publicLoyaltySummary(slug, activeEmail ?? undefined),
  });

  const menu = menuQ.data;

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
        <p className="text-sm text-zinc-500">Check the link — this page may have moved.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <header className="relative border-b border-line">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-10 text-center">
          {menu.org.logo_url ? (
            <img src={menu.org.logo_url} alt={menu.org.name} className="h-20 w-20 rounded-2xl object-cover ring-1 ring-white/15" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-accent-400">
              <span className="font-display text-3xl font-bold text-zinc-950">{menu.org.name[0]}</span>
            </div>
          )}
          <h1 className="font-display text-3xl font-bold text-white">{menu.org.name} Rewards</h1>
          <Link
            href={`/r/${slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to menu
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {redeemed ? (
          <div className="space-y-4 rounded-2xl border border-brand-400/30 bg-brand-400/5 p-6 text-center">
            <p className="font-display text-xl font-bold text-white">{redeemed.reward} unlocked!</p>
            <p className="text-sm text-zinc-400">
              Code <span className="font-mono font-semibold text-brand-300">{redeemed.code}</span> — apply it at checkout.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href={`/r/${slug}?voucher=${encodeURIComponent(redeemed.code)}&reward=${encodeURIComponent(redeemed.reward)}`}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-accent-400 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-lg shadow-brand-500/20 transition-all hover:brightness-110 active:scale-[0.97]"
              >
                Order now with this reward
              </Link>
              <button
                onClick={() => setRedeemed(null)}
                className="cursor-pointer rounded-xl border border-line bg-white/[0.03] px-4 py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:bg-white/[0.06]"
              >
                Back to rewards
              </button>
            </div>
          </div>
        ) : (
          <LoyaltyPanel
            slug={slug}
            summary={loyaltyQ.data}
            loading={loyaltyQ.isFetching}
            email={email}
            setEmail={setEmail}
            activeEmail={activeEmail}
            onLookup={() => {
              const next = email.trim().toLowerCase() || null;
              setActiveEmail(next);
              if (next) rememberEmail(next);
            }}
            onChanged={() => loyaltyQ.refetch()}
            onRedeemed={(code, reward) => setRedeemed({ code, reward })}
          />
        )}
      </main>

      <footer className="mx-auto max-w-2xl px-4 pt-4 pb-8 text-center">
        <p className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
          <CircleDot className="h-3.5 w-3.5" /> Powered by Dish<span className="text-gradient font-semibold">Data</span>
        </p>
      </footer>
    </div>
  );
}
