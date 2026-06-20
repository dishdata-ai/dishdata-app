"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import NavLink from "@/components/NavLink";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu as MenuIcon, X, Bell, CircleDot, LogOut, ChevronDown, Compass, ExternalLink, Search } from "lucide-react";
import TourOverlay from "@/components/TourOverlay";
import CommandPalette from "@/components/CommandPalette";
import { listNotifications, markAllRead } from "@/lib/api/notifications";
import { useRealtimeInvalidate } from "@/lib/hooks/useRealtimeInvalidate";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/useAuth";
import { useOrg } from "@/lib/hooks/useOrg";
import { MODULES, MODULE_GROUPS } from "@/lib/modules";
import type { ModuleDef } from "@/lib/modules";
import { Badge } from "@/components/ui";

function OrgLogo({ size = 36 }: { size?: number }) {
  const { org } = useOrg();
  if (org?.logo_url) {
    return (
      <img
        src={org.logo_url}
        alt={org.name}
        style={{ width: size, height: size }}
        className="rounded-xl object-cover ring-1 ring-white/15"
      />
    );
  }
  const letter = org?.name?.trim()?.[0]?.toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-400 shadow-lg shadow-brand-500/25"
    >
      {letter ? (
        <span className="font-display text-base font-bold text-zinc-950">{letter}</span>
      ) : (
        <CircleDot className="h-5 w-5 text-zinc-950" strokeWidth={2.5} />
      )}
    </div>
  );
}

function SidebarNav({ items, onNavigate }: { items: ModuleDef[]; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {MODULE_GROUPS.map((group) => {
        const groupItems = items.filter((m) => m.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
              {group}
            </p>
            <div className="space-y-0.5">
              {groupItems.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  onClick={onNavigate}
                  data-tour={`nav-${item.id}`}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                      isActive
                        ? "bg-gradient-to-r from-brand-500/15 to-accent-400/5 text-brand-300 ring-1 ring-brand-400/20"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100",
                    )
                  }
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function NotificationBell() {
  const { org } = useOrg();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useRealtimeInvalidate("notifications", ["notifications"]);

  const q = useQuery({
    queryKey: ["org", org?.id, "notifications"],
    queryFn: () => listNotifications(org!.id),
    enabled: !!org,
    refetchInterval: 60_000,
  });
  const notifications = q.data ?? [];
  const unread = notifications.filter((n) => !n.read_at).length;

  const openPanel = async () => {
    setOpen((o) => !o);
    if (!open && unread > 0) {
      await markAllRead(org!.id);
      qc.invalidateQueries({ queryKey: ["org", org?.id, "notifications"] });
    }
  };

  return (
    <div className="relative">
      <button
        onClick={openPanel}
        className="relative cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-soft px-1 text-[9px] font-bold text-zinc-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="animate-rise absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-line bg-raised shadow-2xl">
            <div className="border-b border-line px-4 py-2.5 text-sm font-semibold text-white">Notifications</div>
            <div className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="p-6 text-center text-xs text-zinc-500">
                  Nothing yet — low stock, ready orders, deliveries and bookings show up here.
                </p>
              ) : (
                notifications.map((n) => (
                  <div key={n.id} className="border-b border-line/50 px-4 py-3 last:border-0">
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white">{n.title}</p>
                        {n.body && <p className="mt-0.5 text-xs text-zinc-400">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-zinc-600">
                          {new Date(n.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { org, role, moduleIds } = useOrg();
  const { user, signOut, isDemo } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const navItems = useMemo(() => MODULES.filter((m) => moduleIds.has(m.id)), [moduleIds]);

  // Mobile bottom tabs: the 4 most useful accessible modules + "More"
  const mobileTabs = useMemo(() => {
    const priority = ["myday", "dashboard", "pos", "kitchen", "tasks", "timeclock", "floor", "inventory"];
    return priority
      .map((id) => navItems.find((m) => m.id === id))
      .filter((m): m is ModuleDef => !!m)
      .slice(0, 4);
  }, [navItems]);

  const currentTitle =
    MODULES.find((m) => m.path === pathname)?.name ?? "DishData";

  // Apply custom accent color as a runtime token override
  useEffect(() => {
    const root = document.documentElement;
    if (org?.accent_color) {
      root.style.setProperty("--color-brand-400", org.accent_color);
      root.style.setProperty("--color-brand-500", org.accent_color);
      root.style.setProperty("--color-brand-300", org.accent_color);
    } else {
      root.style.removeProperty("--color-brand-400");
      root.style.removeProperty("--color-brand-500");
      root.style.removeProperty("--color-brand-300");
    }
  }, [org?.accent_color]);

  const initials =
    (user?.fullName || user?.email || "?")
      .split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const brandBlock = (
    <div className="flex items-center gap-2.5">
      <OrgLogo />
      <div className="min-w-0 leading-tight">
        <p className="truncate font-display text-base font-bold text-white">{org?.name ?? "DishData"}</p>
        <p className="text-[10px] tracking-widest text-zinc-500 uppercase">
          Powered by Dish<span className="text-gradient">Data</span>
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface/60 backdrop-blur-xl lg:flex">
        <div className="border-b border-line px-4 py-4">{brandBlock}</div>
        <SidebarNav items={navItems} />
        <div className="border-t border-line p-4 text-xs text-zinc-500">
          <p className="font-medium text-zinc-300 capitalize">{role ?? "member"}</p>
          <p className="mt-0.5">DishData v2 · {isDemo ? "Demo mode" : "Connected"}</p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="animate-fade absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-4">
              {brandBlock}
              <button onClick={() => setMobileOpen(false)} className="text-zinc-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav items={navItems} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-base/70 px-4 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 lg:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <span className="hidden text-sm font-medium text-zinc-400 sm:block">
              {org?.name}
              <span className="mx-2 text-zinc-600">/</span>
              <span className="text-zinc-100">{currentTitle}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
              }
              className="hidden cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300 md:flex"
            >
              <Search className="h-3.5 w-3.5" />
              Search
              <kbd className="rounded border border-line px-1 text-[10px]">⌘K</kbd>
            </button>
            {isDemo && <Badge tone="amber">Demo</Badge>}
            <span className="hidden items-center gap-1.5 rounded-full bg-brand-400/10 px-3 py-1 text-xs font-medium text-brand-300 ring-1 ring-brand-400/20 sm:inline-flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
              Live
            </span>
            <NotificationBell />
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((o) => !o)}
                data-tour="user-menu"
                className="flex cursor-pointer items-center gap-1.5"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-soft to-accent-400 text-xs font-bold text-zinc-950">
                  {initials}
                </div>
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="animate-rise absolute right-0 z-50 mt-2 w-56 rounded-xl border border-line bg-raised p-1.5 shadow-2xl">
                    <div className="border-b border-line px-3 py-2.5">
                      <p className="truncate text-sm font-semibold text-white">{user?.fullName || "Account"}</p>
                      <p className="truncate text-xs text-zinc-500">{user?.email}</p>
                      <Badge tone="cyan" className="mt-1.5 capitalize">{role}</Badge>
                    </div>
                    <a
                      href={`/r/${org?.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setUserMenuOpen(false)}
                      className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
                    >
                      <ExternalLink className="h-4 w-4" /> View public page
                    </a>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        window.dispatchEvent(new Event("dishdata:start-tour"));
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
                    >
                      <Compass className="h-4 w-4" /> Replay intro tour
                    </button>
                    <button
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await signOut();
                        router.push("/auth");
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 md:px-6 md:py-8 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {mobileTabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.path}
              className={({ isActive }) =>
                cn(
                  "flex min-w-14 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-colors",
                  isActive ? "text-brand-300" : "text-zinc-500 hover:text-zinc-300",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn("rounded-lg px-2.5 py-0.5", isActive && "bg-brand-400/10")}>
                    <tab.icon className="h-5 w-5" />
                  </span>
                  <span className="text-[10px] font-medium">
                    {tab.id === "pos" ? "POS" : tab.id === "myday" ? "My Day" : tab.name.split(" ")[0]}
                  </span>
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex min-w-14 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <span className="rounded-lg px-2.5 py-0.5">
              <MenuIcon className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      <TourOverlay />
      <CommandPalette />
    </div>
  );
}
