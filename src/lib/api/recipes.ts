import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoAudit } from "@/lib/api/notifications";
import type { Recipe, RecipeIngredient, InventoryItem } from "@/lib/api/database.types";
import type { RecipeWithIngredients } from "@/lib/calc";
import { computeIngredientCost } from "@/lib/units";

const dRecipes = demoTable<Recipe>("recipes");
const dIngredients = demoTable<RecipeIngredient>("recipe_ingredients");
const dInventory = demoTable<InventoryItem>("inventory_items");

/**
 * A linked ingredient's cost is computed live from the stock item's current
 * price — the "derived costing" wire (inventory rebuild Phase 1). An
 * unlinked line, or one whose units can't be reconciled, falls back to
 * cost_override / the stored cost, unchanged from before this existed.
 */
function liveIngredientCost(
  ing: RecipeIngredient,
  stock: Pick<InventoryItem, "unit" | "unit_cost" | "grams_per_unit"> | null | undefined,
): number {
  if (!stock) return ing.cost_override ?? ing.cost;
  const live = computeIngredientCost({
    qtyNumeric: ing.qty_numeric,
    ingredientUnit: ing.unit,
    yieldPct: ing.yield_pct,
    stockUnit: stock.unit,
    stockUnitCost: stock.unit_cost,
    gramsPerUnit: stock.grams_per_unit,
  });
  return live ?? ing.cost_override ?? ing.cost;
}

export async function listRecipes(orgId: string): Promise<RecipeWithIngredients[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const ings = dIngredients.list({ org_id: orgId } as Partial<RecipeIngredient>);
    const items = dInventory.list({ org_id: orgId } as Partial<InventoryItem>);
    const byId = new Map(items.map((i) => [i.id, i]));
    return dRecipes
      .list({ org_id: orgId } as Partial<Recipe>)
      .map((r) => ({
        ...r,
        ingredients: ings
          .filter((i) => i.recipe_id === r.id)
          .map((i) => ({ ...i, cost: liveIngredientCost(i, i.inventory_item_id ? byId.get(i.inventory_item_id) : null) })),
      }));
  }
  const { data, error } = await getSupabase()
    .from("recipes")
    .select("*, recipe_ingredients(*, inventory_items(unit, unit_cost, grams_per_unit))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const { recipe_ingredients, ...rest } = r as Recipe & {
      recipe_ingredients: (RecipeIngredient & {
        inventory_items: Pick<InventoryItem, "unit" | "unit_cost" | "grams_per_unit"> | null;
      })[];
    };
    const ingredients = (recipe_ingredients ?? []).map((ri) => {
      const { inventory_items: stock, ...ing } = ri;
      return { ...ing, cost: liveIngredientCost(ing, stock) };
    });
    return { ...rest, ingredients };
  });
}

export interface NewRecipeInput {
  name: string;
  category: string;
  price: number;
  prep_minutes: number;
  emoji: string;
  description: string | null;
  /** null = inherit the org's default rate. */
  tax_rate: number | null;
  name_de?: string | null;
  description_de?: string | null;
  category_de?: string | null;
  diet?: "veg" | "vegan" | null;
  ingredients: {
    name: string;
    qty_display: string;
    qty_numeric: number;
    /** Only meaningful for a line with no inventory_item_id — a linked line's cost is always computed. */
    cost: number;
    inventory_item_id: string | null;
    /** Null = same unit as the linked stock item. */
    unit?: string | null;
    yield_pct?: number;
  }[];
}

/** demoTable has no DB column defaults — fill the ones a real insert gets for free. */
function toDemoIngredient(ing: NewRecipeInput["ingredients"][number]): Omit<RecipeIngredient, "id" | "org_id" | "recipe_id"> {
  return { ...ing, unit: ing.unit ?? null, yield_pct: ing.yield_pct ?? 100, cost_override: null };
}

export async function createRecipe(orgId: string, input: NewRecipeInput): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const recipe: Recipe = {
      id: uid(), org_id: orgId, name: input.name, category: input.category,
      price: input.price, prep_minutes: input.prep_minutes, emoji: input.emoji,
      description: input.description,
      name_de: input.name_de ?? null, description_de: input.description_de ?? null,
      category_de: input.category_de ?? null,
      image_url: null, is_active: true, sold_out_until: null, tax_rate: input.tax_rate,
      diet: input.diet ?? null,
    };
    dRecipes.insert(recipe);
    for (const ing of input.ingredients) {
      dIngredients.insert({ id: uid(), org_id: orgId, recipe_id: recipe.id, ...toDemoIngredient(ing) });
    }
    pushDemoAudit(orgId, "recipes", "INSERT", recipe.id, { name: recipe.name });
    return recipe.id;
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from("recipes")
    .insert({
      org_id: orgId, name: input.name, category: input.category, price: input.price,
      prep_minutes: input.prep_minutes, emoji: input.emoji, description: input.description,
      tax_rate: input.tax_rate,
      name_de: input.name_de ?? null, description_de: input.description_de ?? null,
      category_de: input.category_de ?? null,
      diet: input.diet ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const recipeId = data.id as string;
  if (input.ingredients.length) {
    const { error: ingError } = await sb.from("recipe_ingredients").insert(
      input.ingredients.map((i) => ({ org_id: orgId, recipe_id: recipeId, ...i })),
    );
    if (ingError) throw ingError;
  }
  return recipeId;
}

export async function updateRecipe(orgId: string, id: string, patch: Partial<Recipe>): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    dRecipes.update(id, patch);
    return;
  }
  const { error } = await getSupabase().from("recipes").update(patch).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Replaces a recipe's whole ingredient list (delete + reinsert) — used when editing. */
export async function replaceRecipeIngredients(
  orgId: string,
  recipeId: string,
  ingredients: NewRecipeInput["ingredients"],
): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    for (const ing of dIngredients.list({ recipe_id: recipeId } as Partial<RecipeIngredient>)) {
      dIngredients.remove(ing.id);
    }
    for (const ing of ingredients) {
      dIngredients.insert({ id: uid(), org_id: orgId, recipe_id: recipeId, ...toDemoIngredient(ing) });
    }
    return;
  }
  const sb = getSupabase();
  const { error: delError } = await sb
    .from("recipe_ingredients")
    .delete()
    .eq("recipe_id", recipeId)
    .eq("org_id", orgId);
  if (delError) throw delError;
  if (ingredients.length) {
    const { error: insError } = await sb
      .from("recipe_ingredients")
      .insert(ingredients.map((i) => ({ org_id: orgId, recipe_id: recipeId, ...i })));
    if (insError) throw insError;
  }
}

export interface TranslateInput {
  name: string;
  description?: string | null;
  category?: string | null;
}

export interface TranslateResult {
  name_de: string;
  description_de: string | null;
  category_de: string | null;
}

/**
 * AI-translate a menu item's name/description/category to German via
 * /api/recipes/translate. Requires Supabase (the route checks auth) — in
 * demo mode there's no session to authenticate, so callers should hide the
 * "Translate" action rather than call this.
 */
export async function translateRecipe(input: TranslateInput): Promise<TranslateResult> {
  const res = await fetch("/api/recipes/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Translation failed.");
  return data as TranslateResult;
}

export async function deleteRecipe(orgId: string, id: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const r = dRecipes.get(id);
    dRecipes.remove(id);
    for (const ing of dIngredients.list({ recipe_id: id } as Partial<RecipeIngredient>)) {
      dIngredients.remove(ing.id);
    }
    pushDemoAudit(orgId, "recipes", "DELETE", id, { name: r?.name ?? "recipe" });
    return;
  }
  const { error } = await getSupabase().from("recipes").delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}
