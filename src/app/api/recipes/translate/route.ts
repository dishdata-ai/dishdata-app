import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { translateMenuItem } from "@/lib/translate";

export const runtime = "nodejs";

/**
 * POST /api/recipes/translate
 * Body: { name: string, description?: string | null, category?: string | null }
 * Returns { name_de, description_de, category_de }. Requires a signed-in user
 * (any org) — this doesn't touch the database, the caller writes the result
 * onto the recipe itself via the normal update path, which is RLS-scoped.
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = (await request.json()) as { name?: string; description?: string | null; category?: string | null };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  try {
    const result = await translateMenuItem({
      name: body.name,
      description: body.description,
      category: body.category,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Translation failed." },
      { status: 500 },
    );
  }
}
