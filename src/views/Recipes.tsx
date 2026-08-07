import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, Plus, Clock, Flame, Trash2, ChefHat, ImagePlus, Pencil, Ban, CheckCircle2 } from "lucide-react";
import {
  Card,
  SectionTitle,
  Button,
  Badge,
  Modal,
  Input,
  Select,
  Field,
  ProgressBar,
  EmptyState,
  PageSkeleton,
} from "@/components/ui";
import { useRecipes, useInventory, useOrders, useInvalidate } from "@/lib/hooks/data";
import { EventMenusCard } from "@/components/EventMenus";
import { useOrg } from "@/lib/hooks/useOrg";
import { useFmt } from "@/lib/hooks/useFmt";
import { createRecipe, deleteRecipe, updateRecipe, replaceRecipeIngredients, type NewRecipeInput } from "@/lib/api/recipes";
import { uploadOrgAsset } from "@/lib/api/orgs";
import {
  recipeCost,
  marginPct,
  popularityScores,
  isSoldOut,
  isSoldOutIndefinitely,
  endOfToday,
  SOLD_OUT_INDEFINITELY,
  type RecipeWithIngredients,
} from "@/lib/calc";
import { toast } from "@/lib/toast";
import { cn, fmtPct, uid } from "@/lib/utils";

const categories = ["All", "Mains", "Appetizers", "Desserts", "Beverages", "Specials"] as const;

interface IngRow {
  key: string;
  name: string;
  qty_display: string;
  cost: string;
  inventory_item_id: string;
  qty_numeric: string;
}

function RecipeForm({ recipe, onDone }: { recipe?: RecipeWithIngredients | null; onDone: () => void }) {
  const { org } = useOrg();
  const fmt = useFmt();
  const inventoryQ = useInventory();
  const invalidate = useInvalidate();
  const isEdit = !!recipe;
  const [name, setName] = useState(recipe?.name ?? "");
  const [category, setCategory] = useState(recipe?.category ?? "Mains");
  const [price, setPrice] = useState(recipe ? String(recipe.price) : "");
  const [prep, setPrep] = useState(recipe ? String(recipe.prep_minutes) : "");
  const [emoji, setEmoji] = useState(recipe?.emoji ?? "🍽️");
  const [rows, setRows] = useState<IngRow[]>(
    recipe && recipe.ingredients.length
      ? recipe.ingredients.map((i) => ({
          key: uid(),
          name: i.name,
          qty_display: i.qty_display,
          cost: String(i.cost),
          inventory_item_id: i.inventory_item_id ?? "",
          qty_numeric: String(i.qty_numeric),
        }))
      : [{ key: uid(), name: "", qty_display: "", cost: "", inventory_item_id: "", qty_numeric: "" }],
  );

  const setRow = (key: string, patch: Partial<IngRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const plateCost = rows.reduce((s, r) => s + (+r.cost || 0), 0);
  const valid = name.trim() && +price > 0 && rows.some((r) => r.name.trim());

  const save = useMutation({
    mutationFn: async () => {
      const ingredients = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          qty_display: r.qty_display,
          qty_numeric: +r.qty_numeric || 0,
          cost: +r.cost || 0,
          inventory_item_id: r.inventory_item_id || null,
        }));
      if (isEdit) {
        await updateRecipe(org!.id, recipe!.id, {
          name: name.trim(),
          category,
          price: +price,
          prep_minutes: +prep || 10,
          emoji: emoji || "🍽️",
        });
        await replaceRecipeIngredients(org!.id, recipe!.id, ingredients);
        return recipe!.id;
      }
      const input: NewRecipeInput = {
        name: name.trim(), category, price: +price, prep_minutes: +prep || 10, emoji: emoji || "🍽️", ingredients,
      };
      return createRecipe(org!.id, input);
    },
    onSuccess: () => {
      invalidate("recipes");
      toast.success(isEdit ? "Recipe updated" : "Recipe saved", `${name.trim()} ${isEdit ? "is updated" : "is now on the menu"}`);
      onDone();
    },
    onError: (e) => toast.error("Could not save recipe", e instanceof Error ? e.message : ""),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Field label="Emoji">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="w-16 text-center text-lg" />
        </Field>
        <div className="flex-1">
          <Field label="Recipe name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seared Duck Breast" />
          </Field>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Category">
          <Input value={category} onChange={(e) => setCategory(e.target.value)} list="recipe-categories" placeholder="Mains" />
          <datalist id="recipe-categories">
            {categories.slice(1).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Menu price">
          <Input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="24" />
        </Field>
        <Field label="Prep (min)">
          <Input type="number" min="0" value={prep} onChange={(e) => setPrep(e.target.value)} placeholder="15" />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">
          Ingredients — link to inventory to auto-deplete stock on every sale
        </p>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="space-y-2 rounded-xl border border-line bg-white/[0.02] p-2.5">
              <div className="flex gap-2">
                <Input placeholder="Ingredient" value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} />
                <Input placeholder="Qty (e.g. 200g)" className="w-28" value={r.qty_display} onChange={(e) => setRow(r.key, { qty_display: e.target.value })} />
                <Input placeholder="Cost" type="number" min="0" step="0.1" className="w-24" value={r.cost} onChange={(e) => setRow(r.key, { cost: e.target.value })} />
                <button
                  onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                  disabled={rows.length === 1}
                  className="cursor-pointer rounded-lg p-2 text-zinc-500 hover:text-rose-soft disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-2">
                <Select
                  value={r.inventory_item_id}
                  onChange={(e) => setRow(r.key, { inventory_item_id: e.target.value })}
                  className="flex-1 text-xs"
                >
                  <option value="">No stock link (cost only)</option>
                  {(inventoryQ.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      ↳ depletes {i.name} ({i.unit})
                    </option>
                  ))}
                </Select>
                {r.inventory_item_id && (
                  <Input
                    placeholder="Stock used / plate"
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-44 text-xs"
                    value={r.qty_numeric}
                    onChange={(e) => setRow(r.key, { qty_numeric: e.target.value })}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setRows((prev) => [...prev, { key: uid(), name: "", qty_display: "", cost: "", inventory_item_id: "", qty_numeric: "" }])}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-400 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add ingredient
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] p-3 text-sm">
        <span className="text-zinc-400">Plate cost</span>
        <span className="font-semibold text-white">
          {fmt(plateCost, 2)}
          {+price > 0 && (
            <span className="ml-2 text-brand-300">({fmtPct(((+price - plateCost) / +price) * 100, 0)} margin)</span>
          )}
        </span>
      </div>
      <Button className="w-full" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Save Recipe"}
      </Button>
    </div>
  );
}

export default function Recipes() {
  const { org, isManager } = useOrg();
  const fmt = useFmt();
  const recipesQ = useRecipes();
  const ordersQ = useOrders();
  const invalidate = useInvalidate();
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecipeWithIngredients | null>(null);
  const [editing, setEditing] = useState<RecipeWithIngredients | null>(null);
  const [adding, setAdding] = useState(false);

  const recipes = recipesQ.data ?? [];
  const popularity = useMemo(() => popularityScores(recipes, ordersQ.data ?? []), [recipes, ordersQ.data]);

  const filtered = useMemo(
    () =>
      recipes.filter(
        (r) =>
          (category === "All" || r.category === category) &&
          r.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [recipes, category, query],
  );

  const uploadPhoto = async (r: RecipeWithIngredients, file: File) => {
    try {
      const url = await uploadOrgAsset(org!.id, file, `recipes/${r.id}.webp`);
      await updateRecipe(org!.id, r.id, { image_url: url });
      invalidate("recipes");
      setSelected((s) => (s && s.id === r.id ? { ...s, image_url: url } : s));
      toast.success("Photo added", `${r.name} now has an image`);
    } catch (e) {
      toast.error("Upload failed", e instanceof Error ? e.message : "");
    }
  };

  const setSoldOut = async (r: RecipeWithIngredients, until: string | null) => {
    try {
      await updateRecipe(org!.id, r.id, { sold_out_until: until });
      invalidate("recipes");
      setSelected((s) => (s && s.id === r.id ? { ...s, sold_out_until: until } : s));
      toast.success(
        until ? `${r.name} marked sold out` : `${r.name} is available again`,
        until === SOLD_OUT_INDEFINITELY ? "Until you turn it back on" : until ? "Clears automatically tonight" : "",
      );
    } catch (e) {
      toast.error("Could not update", e instanceof Error ? e.message : "");
    }
  };

  const removeRecipe = async (r: RecipeWithIngredients) => {
    try {
      await deleteRecipe(org!.id, r.id);
      invalidate("recipes");
      setSelected(null);
      toast.success("Recipe removed", r.name);
    } catch (e) {
      toast.error("Could not delete", e instanceof Error ? e.message : "");
    }
  };

  if (recipesQ.isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Recipes"
        subtitle="Standardized recipes with live plate costing and stock-linked ingredients."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> New Recipe
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input placeholder="Search recipes…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={cn(
                "shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                category === c
                  ? "bg-gradient-to-r from-brand-500 to-accent-400 text-zinc-950"
                  : "border border-line bg-white/[0.03] text-zinc-400 hover:text-white",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {recipes.length === 0 ? (
        <Card>
          <EmptyState
            icon={ChefHat}
            title="No recipes yet"
            hint="Create your first recipe with costed ingredients — it instantly appears in the POS."
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> New Recipe
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const cost = recipeCost(r);
            const margin = marginPct(r);
            const pop = popularity.get(r.id) ?? 0;
            const soldOut = isSoldOut(r);
            return (
              <button key={r.id} onClick={() => setSelected(r)} className="cursor-pointer text-left">
                <Card className={cn("h-full overflow-hidden p-0 transition-all hover:border-brand-400/40 hover:shadow-lg hover:shadow-brand-500/10", soldOut && "opacity-60")}>
                  {r.image_url && <img src={r.image_url} alt={r.name} className="h-28 w-full object-cover" />}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      {!r.image_url && <span className="text-4xl">{r.emoji}</span>}
                      <div className={cn("flex items-center gap-1.5", r.image_url && "ml-auto")}>
                        {soldOut && (
                          <Badge tone="rose">
                            {isSoldOutIndefinitely(r) ? "Sold out" : "Sold out today"}
                          </Badge>
                        )}
                        <Badge tone={margin >= 70 ? "green" : margin >= 60 ? "cyan" : "amber"}>
                          {fmtPct(margin, 0)} margin
                        </Badge>
                      </div>
                    </div>
                    <h3 className="mt-3 font-semibold text-white">{r.name}</h3>
                    <p className="text-xs text-zinc-500">{r.category}</p>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <span className="text-zinc-400">
                        Cost <span className="font-semibold text-white">{fmt(cost, 2)}</span>
                      </span>
                      <span className="font-bold text-brand-300">{fmt(r.price, 2)}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {r.prep_minutes} min
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Flame className="h-3.5 w-3.5" /> {pop}% popularity
                      </span>
                    </div>
                    <ProgressBar value={pop} tone="cyan" className="mt-2" />
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ""} wide>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {selected.image_url ? (
                <img src={selected.image_url} alt={selected.name} className="h-16 w-16 rounded-xl object-cover" />
              ) : (
                <span className="text-5xl">{selected.emoji}</span>
              )}
              <div>
                <Badge tone="neutral">{selected.category}</Badge>
                <p className="mt-1 text-xs text-zinc-500">
                  {selected.prep_minutes} min prep · {popularity.get(selected.id) ?? 0}% popularity
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="font-display text-gradient text-2xl font-bold">{fmt(selected.price, 2)}</p>
                <p className="text-xs text-zinc-500">menu price</p>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-white/[0.02]">
              <div className="border-b border-line px-4 py-2.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">
                Cost breakdown
              </div>
              <div className="divide-y divide-line/60">
                {selected.ingredients.map((i) => (
                  <div key={i.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-zinc-200">
                      {i.name}
                      {i.inventory_item_id && (
                        <Badge tone="cyan" className="ml-2">stock-linked</Badge>
                      )}
                    </span>
                    <span className="text-zinc-500">{i.qty_display}</span>
                    <span className="w-16 text-right font-medium text-white">{fmt(i.cost, 2)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between border-t border-line px-4 py-3 text-sm font-semibold">
                <span className="text-zinc-300">Plate cost</span>
                <span className="text-white">{fmt(recipeCost(selected), 2)}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              {(
                [
                  ["Food cost", fmtPct((recipeCost(selected) / selected.price) * 100, 1)],
                  ["Gross margin", fmtPct(marginPct(selected), 1)],
                  ["Profit / plate", fmt(selected.price - recipeCost(selected), 2)],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <p className="text-xs text-zinc-500">{label}</p>
                  <p className="mt-1 font-display text-lg font-bold text-brand-300">{val}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-line bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Availability</p>
                {isSoldOut(selected) && (
                  <Badge tone="rose">{isSoldOutIndefinitely(selected) ? "Sold out indefinitely" : "Sold out today"}</Badge>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  variant={!isSoldOut(selected) ? "primary" : "ghost"}
                  className="flex-1 py-2 text-xs"
                  onClick={() => setSoldOut(selected, null)}
                  disabled={!isSoldOut(selected)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Available
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 py-2 text-xs"
                  onClick={() => setSoldOut(selected, endOfToday())}
                >
                  <Ban className="h-3.5 w-3.5" /> Sold out today
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1 py-2 text-xs"
                  onClick={() => setSoldOut(selected, SOLD_OUT_INDEFINITELY)}
                >
                  <Ban className="h-3.5 w-3.5" /> Sold out indefinitely
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  setEditing(selected);
                  setSelected(null);
                }}
              >
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-white/[0.03] py-2 text-sm font-semibold text-zinc-200 hover:border-zinc-500">
                <ImagePlus className="h-4 w-4" /> {selected.image_url ? "Replace photo" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(selected, f);
                  }}
                />
              </label>
              {isManager && (
                <Button variant="danger" onClick={() => removeRecipe(selected)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <EventMenusCard />

      <Modal open={adding} onClose={() => setAdding(false)} title="New Recipe" wide>
        <RecipeForm onDone={() => setAdding(false)} />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : ""} wide>
        {editing && <RecipeForm recipe={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
