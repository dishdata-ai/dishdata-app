import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export interface TranslateMenuItemInput {
  name: string;
  description?: string | null;
  category?: string | null;
}

export interface TranslateMenuItemResult {
  name_de: string;
  description_de: string | null;
  category_de: string | null;
}

const MODEL = "claude-sonnet-4-20250514";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name_de", "description_de", "category_de"],
  properties: {
    name_de: { type: "string" },
    description_de: { anyOf: [{ type: "string" }, { type: "null" }] },
    category_de: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

const SYSTEM_PROMPT = `You translate restaurant menu text from English to German, for a South Indian / Kerala restaurant menu printed and shown to German customers.

Rules:
- Dish names built from Malayalam/Indian terms (Porotta, Biriyani, Paneer, Puttu, Kadala, Dosa, Idli, Chutney, Sambar, Kappa, etc.) stay as-is — do not translate or transliterate them.
- Only translate the English descriptive words around those terms (e.g. "with", "curry", "roast", "fried" -> "mit", "Curry", "Braten", "gebraten").
- Keep it natural, concise menu German — not a literal word-for-word translation.
- Category names should read like real German menu section headers (e.g. "Snacks" stays "Snacks", "Rice Bowl" -> "Reisschale", "Starters" -> "Vorspeisen").
- If description is null/empty, return description_de as null. Same for category.`;

/** Translate a menu item's name/description/category from English to German via Claude. */
export async function translateMenuItem(input: TranslateMenuItemInput): Promise<TranslateMenuItemResult> {
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY from env

  const parts = [
    `Name: ${input.name}`,
    input.description ? `Description: ${input.description}` : null,
    input.category ? `Category: ${input.category}` : null,
  ].filter(Boolean);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: parts.join("\n") }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Translation was declined by the model's safety system.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No translation returned.");
  }
  return JSON.parse(textBlock.text) as TranslateMenuItemResult;
}
