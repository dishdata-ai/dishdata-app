"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarRange, Plus, Pencil, Trash2, Check, Globe, ChefHat } from "lucide-react";
import { Card, Button, Badge, Modal, Input, Field, EmptyState } from "@/components/ui";
import { useEventMenus, useRecipes, useInvalidate } from "@/lib/hooks/data";
import { useOrg } from "@/lib/hooks/useOrg";
import {
  createEventMenu,
  updateEventMenu,
  deleteEventMenu,
  type EventMenuWithItems,
} from "@/lib/api/eventMenus";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { RecipeWithIngredients } from "@/lib/calc";

/**
 * Event / popup menus: a saved, curated subset of the full menu that the POS can
 * switch to for an event where only some dishes are available.
 */
export function EventMenusCard() {
  const { org } = useOrg();
  const menusQ = useEventMenus();
  const recipesQ = useRecipes();
  const invalidate = useInvalidate();

  const [editing, setEditing] = useState<EventMenuWithItems | null>(null);
  const [creating, setCreating] = useState(false);

  const menus = menusQ.data ?? [];
  const recipes = (recipesQ.data ?? []).filter((r) => r.is_active);

  const toggleActive = useMutation({
    mutationFn: (m: EventMenuWithItems) =>
      updateEventMenu(org!.id, m.id, { is_active: !m.is_active }),
    onSuccess: () => invalidate("event_menus"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEventMenu(org!.id, id),
    onSuccess: () => {
      invalidate("event_menus");
      toast.success("Event menu deleted");
    },
  });

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <CalendarRange className="h-4 w-4 text-brand-300" />
              Event &amp; Popup Menus
            </h3>
            <p className="text-xs text-zinc-500">
              A curated subset of dishes the POS can switch to for an event.
            </p>
          </div>
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>

        {menus.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No event menus yet"
            hint="Create one for a popup or event, then pick it in the POS to show only those dishes."
          />
        ) : (
          <div className="divide-y divide-line/60">
            {menus.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-white">
                    {m.name}
                    <Badge tone={m.is_active ? "green" : "neutral"}>
                      {m.is_active ? "Active" : "Off"}
                    </Badge>
                    {m.show_on_website && (
                      <Badge tone="cyan">
                        <Globe className="h-3 w-3" /> Website
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {m.recipe_ids.length} {m.recipe_ids.length === 1 ? "dish" : "dishes"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    className="px-2.5 py-1.5 text-xs"
                    onClick={() => toggleActive.mutate(m)}
                  >
                    {m.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1.5"
                    onClick={() => setEditing(m)}
                    aria-label="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="danger"
                    className="px-2 py-1.5"
                    onClick={() => {
                      if (confirm(`Delete "${m.name}"?`)) remove.mutate(m.id);
                    }}
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <EventMenuEditor
          recipes={recipes}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function EventMenuEditor({
  recipes,
  existing,
  onClose,
}: {
  recipes: RecipeWithIngredients[];
  existing: EventMenuWithItems | null;
  onClose: () => void;
}) {
  const { org } = useOrg();
  const invalidate = useInvalidate();
  const [name, setName] = useState(existing?.name ?? "");
  const [onWebsite, setOnWebsite] = useState(existing?.show_on_website ?? false);
  const [skipKitchen, setSkipKitchen] = useState(existing?.skip_kitchen ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set(existing?.recipe_ids ?? []));

  const grouped = useMemo(() => {
    const by = new Map<string, RecipeWithIngredients[]>();
    for (const r of recipes) {
      const k = r.category || "Other";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [recipes]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const recipeIds = [...selected];
      if (existing) {
        await updateEventMenu(org!.id, existing.id, {
          name: name.trim(),
          show_on_website: onWebsite,
          skip_kitchen: skipKitchen,
          recipeIds,
        });
      } else {
        await createEventMenu(org!.id, name.trim(), recipeIds, onWebsite, skipKitchen);
      }
    },
    onSuccess: () => {
      invalidate("event_menus");
      toast.success(existing ? "Event menu updated" : "Event menu created");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the event menu"),
  });

  const canSave = name.trim().length > 0 && selected.size > 0 && !save.isPending;

  return (
    <Modal open onClose={onClose} title={existing ? "Edit event menu" : "New event menu"} wide>
      <div className="space-y-4">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Onam Popup, Cricket Night"
            autoFocus
          />
        </Field>

        <div className="space-y-2">
          <ToggleRow
            on={onWebsite}
            onToggle={() => setOnWebsite((v) => !v)}
            icon={<Globe className="h-3.5 w-3.5 text-zinc-400" />}
            label="Also show on the website"
            hint={
              onWebsite
                ? "Guests browsing your site will see only this menu while it's active."
                : "Staff-facing only — this menu appears in the POS but not on your website."
            }
          />
          <ToggleRow
            on={skipKitchen}
            onToggle={() => setSkipKitchen((v) => !v)}
            icon={<ChefHat className="h-3.5 w-3.5 text-zinc-400" />}
            label="Food is pre-prepared (skip the kitchen)"
            hint={
              skipKitchen
                ? "Orders are marked served straight away — nothing queues on the Kitchen board."
                : "Orders go to the Kitchen board as usual (New → Preparing → Ready)."
            }
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-400">
              Dishes on this menu{" "}
              <span className="text-zinc-500">
                ({selected.size} of {recipes.length})
              </span>
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                className="cursor-pointer text-xs text-zinc-400 hover:text-white"
                onClick={() => setSelected(new Set(recipes.map((r) => r.id)))}
              >
                Select all
              </button>
              <span className="text-zinc-600">·</span>
              <button
                type="button"
                className="cursor-pointer text-xs text-zinc-400 hover:text-white"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>

          {recipes.length === 0 ? (
            <p className="rounded-xl border border-line bg-white/[0.02] p-4 text-center text-sm text-zinc-400">
              No active dishes yet — add recipes first.
            </p>
          ) : (
            <div className="max-h-[46vh] space-y-3 overflow-y-auto rounded-xl border border-line bg-white/[0.02] p-3">
              {grouped.map(([category, items]) => (
                <div key={category}>
                  <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                    {category}
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {items.map((r) => {
                      const on = selected.has(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggle(r.id)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-all",
                            on
                              ? "border-brand-500/60 bg-brand-500/10 text-white"
                              : "border-line bg-white/[0.02] text-zinc-300 hover:border-zinc-600",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              on ? "border-brand-400 bg-brand-500 text-zinc-950" : "border-zinc-600",
                            )}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="truncate">
                            {r.emoji} {r.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave}>
            {save.isPending ? "Saving…" : existing ? "Save changes" : "Create menu"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A checkbox-style row used for the event menu's behaviour options. */
function ToggleRow({
  on,
  onToggle,
  icon,
  label,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/[0.02] p-3 text-left hover:border-zinc-600"
    >
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          on ? "border-brand-400 bg-brand-500 text-zinc-950" : "border-zinc-600",
        )}
      >
        {on && <Check className="h-3 w-3" />}
      </span>
      <span>
        <span className="flex items-center gap-2 text-sm font-medium text-white">
          {icon}
          {label}
        </span>
        <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>
      </span>
    </button>
  );
}
