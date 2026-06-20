"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, Upload, Check, ArrowRight, ArrowLeft, Store, Palette, Puzzle, Database } from "lucide-react";
import { Button, Input, Field, Select, Badge } from "@/components/ui";
import { useOrg } from "@/lib/hooks/useOrg";
import { createOrganization, updateOrg, uploadOrgAsset, seedSampleData } from "@/lib/api/orgs";
import { MODULES, MODULE_GROUPS } from "@/lib/modules";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "SGD"];

const steps = [
  { title: "Your restaurant", icon: Store },
  { title: "Branding", icon: Palette },
  { title: "Modules", icon: Puzzle },
  { title: "Sample data", icon: Database },
] as const;

export default function Onboarding() {
  const router = useRouter();
  const { org, refresh } = useOrg();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxRate, setTaxRate] = useState("8.5");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set(MODULES.map((m) => m.id)));
  const [withSample, setWithSample] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Already onboarded? Go home (navigate in an effect, never during render).
  useEffect(() => {
    if (org?.onboarding_completed) router.replace("/");
  }, [org?.onboarding_completed, router]);
  if (org?.onboarding_completed) return null;

  const pickLogo = (f: File | null) => {
    setLogoFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setLogoPreview(url);
    } else setLogoPreview(null);
  };

  const toggleModule = (id: string) => {
    if (["dashboard", "settings", "team", "myday"].includes(id)) return; // essentials
    setEnabledModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finish = async () => {
    setBusy(true);
    try {
      const orgId = org?.id ?? (await createOrganization(name.trim(), currency, +taxRate || 8.5));
      let logo_url: string | null = null;
      if (logoFile) {
        try {
          logo_url = await uploadOrgAsset(orgId, logoFile, "logo.webp");
        } catch (e) {
          toast.error("Logo upload failed", e instanceof Error ? e.message : "You can retry in Settings");
        }
      }
      await updateOrg(orgId, {
        ...(logo_url ? { logo_url } : {}),
        accent_color: accent,
        onboarding_completed: true,
        settings: { enabled_modules: [...enabledModules] },
      });
      if (withSample) await seedSampleData(orgId);
      refresh();
      toast.success(`Welcome to DishData, ${name.trim()}!`, "Your workspace is ready");
      router.replace("/?tour=1");
    } catch (e) {
      toast.error("Setup failed", errorMessage(e, "Please try again"));
    } finally {
      setBusy(false);
    }
  };

  const canNext = step === 0 ? name.trim().length >= 2 : true;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-400">
              <CircleDot className="h-5 w-5 text-zinc-950" strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg font-bold text-white">
              Dish<span className="text-gradient">Data</span>
            </span>
          </div>
          <Badge tone="cyan">Setup · {step + 1} of {steps.length}</Badge>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s.title} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all",
                  i < step
                    ? "bg-brand-400 text-zinc-950"
                    : i === step
                      ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                      : "border border-line bg-white/[0.03] text-zinc-500",
                )}
              >
                {i < step ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
              </div>
              <span className={cn("hidden text-xs font-medium sm:block", i === step ? "text-white" : "text-zinc-500")}>
                {s.title}
              </span>
              {i < steps.length - 1 && <div className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        <div className="glass animate-rise rounded-2xl p-8" key={step}>
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Name your restaurant</h2>
                <p className="mt-1 text-sm text-zinc-400">This becomes your workspace. You can change it anytime.</p>
              </div>
              <Field label="Restaurant name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Brass Fig" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Currency">
                  <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sales tax rate (%)">
                  <Input type="number" min="0" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Make it yours</h2>
                <p className="mt-1 text-sm text-zinc-400">Upload your logo — it appears in the sidebar, receipts and your public page.</p>
              </div>
              <div className="flex items-center gap-5">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white/[0.02] transition-all hover:border-brand-400/50"
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="logo preview" className="h-full w-full object-cover" />
                  ) : (
                    <Upload className="h-6 w-6 text-zinc-500 group-hover:text-brand-300" />
                  )}
                </button>
                <div className="flex-1">
                  <p className="text-sm font-medium text-zinc-200">{logoFile ? logoFile.name : "Drop in a square logo"}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">PNG, JPG or SVG · auto-resized · optional</p>
                  {logoFile && (
                    <button onClick={() => pickLogo(null)} className="mt-1.5 cursor-pointer text-xs text-rose-soft hover:underline">
                      Remove
                    </button>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0] ?? null)} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-zinc-400">Accent color (optional)</p>
                <div className="flex gap-2.5">
                  {[null, "#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa"].map((c) => (
                    <button
                      key={c ?? "default"}
                      onClick={() => setAccent(c)}
                      className={cn(
                        "h-9 w-9 cursor-pointer rounded-full transition-all",
                        accent === c ? "ring-2 ring-white ring-offset-2 ring-offset-base" : "opacity-70 hover:opacity-100",
                      )}
                      style={{ background: c ?? "linear-gradient(135deg,#10b981,#22d3ee)" }}
                      title={c ?? "DishData default"}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Pick your modules</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Enable what you need — change anytime in Settings. Per-user access is managed in Team &amp; Access.
                </p>
              </div>
              <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                {MODULE_GROUPS.map((group) => (
                  <div key={group}>
                    <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{group}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {MODULES.filter((m) => m.group === group).map((m) => {
                        const essential = ["dashboard", "settings", "team", "myday"].includes(m.id);
                        const on = enabledModules.has(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() => toggleModule(m.id)}
                            disabled={essential}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-all disabled:cursor-default",
                              on ? "border-brand-400/40 bg-brand-400/5" : "border-line bg-white/[0.02] opacity-60",
                            )}
                          >
                            <m.icon className={cn("h-4 w-4 shrink-0", on ? "text-brand-300" : "text-zinc-500")} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-white">{m.name}</p>
                              <p className="truncate text-[11px] text-zinc-500">{m.blurb}</p>
                            </div>
                            <div
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                                on ? "bg-brand-400 text-zinc-950" : "border border-line",
                              )}
                            >
                              {on && <Check className="h-3 w-3" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Start with sample data?</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  A full demo restaurant — 12 recipes with costed ingredients, stocked inventory, vendors, staff and customers — so every screen comes alive. Recommended for exploring.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { v: true, title: "Load sample data", sub: "Explore with a working demo restaurant (recommended)" },
                  { v: false, title: "Start empty", sub: "I'll add my own menu and inventory" },
                ].map((opt) => (
                  <button
                    key={String(opt.v)}
                    onClick={() => setWithSample(opt.v)}
                    className={cn(
                      "cursor-pointer rounded-xl border p-4 text-left transition-all",
                      withSample === opt.v ? "border-brand-400/50 bg-brand-400/5" : "border-line bg-white/[0.02]",
                    )}
                  >
                    <p className="font-semibold text-white">{opt.title}</p>
                    <p className="mt-1 text-xs text-zinc-500">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nav buttons */}
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {step < steps.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={finish} disabled={busy || !name.trim()}>
                {busy ? "Setting up…" : "Launch Workspace"} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
