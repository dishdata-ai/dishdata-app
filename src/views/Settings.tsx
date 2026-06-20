import { useRef, useState } from "react";
import { Check, Upload, Trash2, Puzzle } from "lucide-react";
import { Card, SectionTitle, Button, Badge, Input, Field, Select } from "@/components/ui";
import { PaymentsCard } from "@/components/PaymentsCard";
import { useOrg } from "@/lib/hooks/useOrg";
import { useAuth } from "@/lib/hooks/useAuth";
import { updateOrg, uploadOrgAsset } from "@/lib/api/orgs";
import { clearDemoData } from "@/lib/api/demoDb";
import { MODULES, MODULE_GROUPS } from "@/lib/modules";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "AUD", "CAD", "SGD"];
const ACCENTS = [null, "#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa"];

export default function Settings() {
  const { org, isAdmin, refresh } = useOrg();
  const { isDemo } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: org?.name ?? "",
    currency: org?.currency ?? "USD",
    tax: String(org?.tax_rate ?? 8.5),
    target: String(org?.target_food_cost_pct ?? 28),
  });
  const [accent, setAccent] = useState<string | null>(org?.accent_color ?? null);
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set((org?.settings?.enabled_modules as string[] | undefined) ?? MODULES.map((m) => m.id)),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!org) return null;

  const save = async () => {
    setSaving(true);
    try {
      await updateOrg(org.id, {
        name: form.name.trim() || org.name,
        currency: form.currency,
        tax_rate: +form.tax || org.tax_rate,
        target_food_cost_pct: +form.target || org.target_food_cost_pct,
        accent_color: accent,
        settings: { ...org.settings, enabled_modules: [...enabled] },
      });
      refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success("Settings saved");
    } catch (e) {
      toast.error("Could not save", e instanceof Error ? e.message : "");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    try {
      const url = await uploadOrgAsset(org.id, file, "logo.webp");
      await updateOrg(org.id, { logo_url: url });
      refresh();
      toast.success("Logo updated");
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "");
    }
  };

  const toggleModule = (id: string) => {
    if (["dashboard", "settings", "team", "myday"].includes(id)) return;
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <SectionTitle title="Settings" subtitle="Workspace profile, branding, targets and enabled modules." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">Restaurant Profile</h3>
          <div className="space-y-4">
            <Field label="Restaurant name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} disabled={!isAdmin} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Currency">
                <Select value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} disabled={!isAdmin}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tax rate (%)">
                <Input type="number" min="0" step="0.1" value={form.tax} onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value }))} disabled={!isAdmin} />
              </Field>
              <Field label="Food cost target (%)">
                <Input type="number" min="0" step="0.5" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} disabled={!isAdmin} />
              </Field>
            </div>
            <p className="text-xs text-zinc-500">
              Tax applies at POS checkout. The food-cost target drives dashboard alerts and repricing insights.
            </p>
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-semibold text-white">Branding</h3>
          <div className="flex items-center gap-4">
            <button
              onClick={() => isAdmin && fileRef.current?.click()}
              className={cn(
                "group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-white/[0.02] transition-all",
                isAdmin && "cursor-pointer hover:border-brand-400/50",
              )}
            >
              {org.logo_url ? (
                <img src={org.logo_url} alt="logo" className="h-full w-full object-cover" />
              ) : (
                <Upload className="h-5 w-5 text-zinc-500" />
              )}
            </button>
            <div>
              <p className="text-sm font-medium text-zinc-200">Workspace logo</p>
              <p className="text-xs text-zinc-500">Shown in the sidebar, receipts and your public page.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
          </div>
          <div className="mt-5">
            <p className="mb-2 text-xs font-medium text-zinc-400">Accent color</p>
            <div className="flex gap-2.5">
              {ACCENTS.map((c) => (
                <button
                  key={c ?? "default"}
                  onClick={() => isAdmin && setAccent(c)}
                  className={cn(
                    "h-8 w-8 cursor-pointer rounded-full transition-all",
                    accent === c ? "ring-2 ring-white ring-offset-2 ring-offset-base" : "opacity-70 hover:opacity-100",
                  )}
                  style={{ background: c ?? "linear-gradient(135deg,#10b981,#22d3ee)" }}
                  title={c ?? "DishData default"}
                />
              ))}
            </div>
          </div>
        </Card>
        <PaymentsCard isAdmin={isAdmin} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-accent-400" />
          <h3 className="font-semibold text-white">Enabled Modules</h3>
          <Badge tone="cyan">{enabled.size} active</Badge>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Org-wide switches. Per-user access on top of this is managed in Team &amp; Access.
        </p>
        <div className="space-y-4">
          {MODULE_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{group}</p>
              <div className="flex flex-wrap gap-2">
                {MODULES.filter((m) => m.group === group).map((m) => {
                  const essential = ["dashboard", "settings", "team", "myday"].includes(m.id);
                  const on = enabled.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleModule(m.id)}
                      disabled={essential || !isAdmin}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all disabled:cursor-default",
                        on
                          ? "border-brand-400/40 bg-brand-400/10 text-brand-300"
                          : "border-line bg-white/[0.02] text-zinc-500",
                      )}
                    >
                      <m.icon className="h-3.5 w-3.5" />
                      {m.name}
                      {essential && <span className="text-[9px] text-zinc-500">(core)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {isAdmin && (
        <div className="flex items-center justify-between">
          <Button onClick={save} disabled={saving}>
            {saved ? (
              <>
                <Check className="h-4 w-4" /> Saved
              </>
            ) : saving ? (
              "Saving…"
            ) : (
              "Save Changes"
            )}
          </Button>
          {isDemo && (
            <Button
              variant="danger"
              onClick={() => {
                clearDemoData();
                window.location.href = "/onboarding";
              }}
            >
              <Trash2 className="h-4 w-4" /> Reset demo data
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
