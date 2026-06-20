import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { uid } from "@/lib/utils";
import { pushDemoAudit } from "@/lib/api/notifications";
import type { Recipe, RecipeIngredient } from "@/lib/api/database.types";
import type { RecipeWithIngredients } from "@/lib/calc";

const dRecipes = demoTable<Recipe>("recipes");
const dIngredients = demoTable<RecipeIngredient>("recipe_ingredients");

export async function listRecipes(orgId: string): Promise<RecipeWithIngredients[]> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const ings = dIngredients.list({ org_id: orgId } as Partial<RecipeIngredient>);
    return dRecipes
      .list({ org_id: orgId } as Partial<Recipe>)
      .map((r) => ({ ...r, ingredients: ings.filter((i) => i.recipe_id === r.id) }));
  }
  const { data, error } = await getSupabase()
    .from("recipes")
    .select("*, recipe_ingredients(*)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const { recipe_ingredients, ...rest } = r as Recipe & { recipe_ingredients: RecipeIngredient[] };
    return { ...rest, ingredients: recipe_ingredients ?? [] };
  });
}

export interface NewRecipeInput {
  name: string;
  category: string;
  price: number;
  prep_minutes: number;
  emoji: string;
  ingredients: {
    name: string;
    qty_display: string;
    qty_numeric: number;
    cost: number;
    inventory_item_id: string | null;
  }[];
}

export async function createRecipe(orgId: string, input: NewRecipeInput): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const recipe: Recipe = {
      id: uid(), org_id: orgId, name: input.name, category: input.category,
      price: input.price, prep_minutes: input.prep_minutes, emoji: input.emoji,
      image_url: null, is_active: true,
    };
    dRecipes.insert(recipe);
    for (const ing of input.ingredients) {
      dIngredients.insert({ id: uid(), org_id: orgId, recipe_id: recipe.id, ...ing });
    }
    pushDemoAudit(orgId, "recipes", "INSERT", recipe.id, { name: recipe.name });
    return recipe.id;
  }
  const sb = getSupabase();
  const { data, error } = await sb
    .from("recipes")
    .insert({
      org_id: orgId, name: input.name, category: input.category, price: input.price,
      prep_minutes: input.prep_minutes, emoji: input.emoji,
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
