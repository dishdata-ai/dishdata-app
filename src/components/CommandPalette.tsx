"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft, Plus, ChefHat, Heart } from "lucide-react";
import { useOrg } from "@/lib/hooks/useOrg";
import { useRecipes, useCustomers } from "@/lib/hooks/data";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  path: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { moduleIds } = useOrg();
  const recipesQ = useRecipes();
  const customersQ = useCustomers();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const items = useMemo((): PaletteItem[] => {
    const q = query.toLowerCase().trim();
    const modules: PaletteItem[] = MODULES.filter((m) => moduleIds.has(m.id)).map((m) => ({
      id: `mod-${m.id}`,
      label: m.name,
      hint: m.blurb,
      icon: m.icon,
      path: m.path,
    }));
    const actions: PaletteItem[] = [
      { id: "act-sale", label: "Ring up a sale", hint: "Open the POS", icon: Plus, path: "/pos" },
      { id: "act-recipe", label: "New recipe", hint: "Add a menu item", icon: ChefHat, path: "/recipes" },
      { id: "act-invite", label: "Invite teammate", hint: "Team & Access", icon: Plus, path: "/team" },
      { id: "act-reserve", label: "Book a reservation", hint: "Floor & Reservations", icon: Plus, path: "/floor" },
    ].filter((a) => moduleIds.has(a.path.slice(1)) || a.path === "/pos");

    const recipes: PaletteItem[] = (recipesQ.data ?? []).slice(0, 50).map((r) => ({
      id: `rec-${r.id}`,
      label: `${r.emoji} ${r.name}`,
      hint: `Recipe · ${r.category}`,
      icon: ChefHat,
      path: "/recipes",
    }));
    const customers: PaletteItem[] = (customersQ.data ?? []).slice(0, 50).map((c) => ({
      id: `cus-${c.id}`,
      label: c.name,
      hint: `Customer · ${c.tier}`,
      icon: Heart,
      path: "/customers",
    }));

    const all = [...modules, ...actions, ...(q ? [...recipes, ...customers] : [])];
    if (!q) return all.slice(0, 12);
    return all.filter((i) => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)).slice(0, 12);
  }, [query, moduleIds, recipesQ.data, customersQ.data]);

  const go = (item: PaletteItem) => {
    setOpen(false);
    router.push(item.path);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="animate-rise w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(items.length - 1, a + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter" && items[active]) go(items[active]);
            }}
            placeholder="Jump to a module, action, recipe or member…"
            className="w-full bg-transparent py-3.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-zinc-500">esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="p-6 text-center text-sm text-zinc-500">No matches for “{query}”.</p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.id}
                onClick={() => go(item)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  i === active ? "bg-white/[0.06]" : "",
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", i === active ? "text-brand-300" : "text-zinc-500")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{item.label}</p>
                  <p className="truncate text-xs text-zinc-500">{item.hint}</p>
                </div>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-500" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
