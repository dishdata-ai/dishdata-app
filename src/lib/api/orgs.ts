import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { demoTable, demoDelay } from "@/lib/api/demoDb";
import { buildSeed } from "@/data/seed";
import { uid } from "@/lib/utils";
import { MODULES } from "@/lib/modules";
import type { Org, Role } from "@/lib/api/database.types";

export interface OrgContext {
  org: Org | null;
  role: Role | null;
  moduleIds: string[];
}

const demoOrgs = demoTable<Org & { next_order_no?: number }>("orgs");

export async function fetchMyOrgContext(userId: string): Promise<OrgContext> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const org = demoOrgs.list()[0] ?? null;
    return { org, role: org ? "owner" : null, moduleIds: MODULES.map((m) => m.id) };
  }
  const sb = getSupabase();
  const { data: memberships, error } = await sb
    .from("org_members")
    .select("role, orgs(*)")
    .eq("user_id", userId);
  if (error) throw error;
  if (!memberships || memberships.length === 0) return { org: null, role: null, moduleIds: [] };

  // Prefer the profile's active org, else the first membership
  const { data: profile } = await sb.from("profiles").select("active_org_id").eq("id", userId).single();
  const active =
    memberships.find((m) => (m.orgs as unknown as Org)?.id === profile?.active_org_id) ?? memberships[0];
  const org = active.orgs as unknown as Org;
  const role = active.role as Role;

  const { data: access } = await sb
    .from("member_module_access")
    .select("module_id, can_access")
    .eq("user_id", userId)
    .eq("org_id", org.id);
  const moduleIds = (access ?? []).filter((a) => a.can_access).map((a) => a.module_id);
  return { org, role, moduleIds };
}

export async function createOrganization(name: string, currency: string, taxRate: number): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "restaurant";
    const org: Org = {
      id: uid(),
      name,
      slug,
      logo_url: null,
      receipt_logo_url: null,
      accent_color: null,
      currency,
      tax_rate: taxRate,
      staff_discount_max_pct: 0,
      staff_discount_monthly_cap: null,
      staff_discount_pin_threshold: null,
      target_food_cost_pct: 28,
      onboarding_completed: false,
      settings: {},
    };
    demoOrgs.insert(org);
    return org.id;
  }
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_organization", {
    _name: name,
    _currency: currency,
    _tax_rate: taxRate,
  });
  if (error) throw error;
  return data as string;
}

export async function updateOrg(orgId: string, patch: Partial<Org>): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    demoOrgs.update(orgId, patch);
    return;
  }
  const { error } = await getSupabase().from("orgs").update(patch).eq("id", orgId);
  if (error) throw error;
}

/** Downscale an image to max 320px and return a Blob (webp). Keeps uploads + demo storage small. */
async function resizeImage(file: File, max = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/webp", 0.9),
  );
}

export async function uploadOrgAsset(orgId: string, file: File, path: string): Promise<string> {
  const blob = await resizeImage(file);
  if (!isSupabaseConfigured) {
    // Store as data URL in demo mode
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read image"));
      reader.readAsDataURL(blob);
    });
  }
  const sb = getSupabase();
  const fullPath = `${orgId}/${path}`;
  const { error } = await sb.storage.from("org-assets").upload(fullPath, blob, {
    upsert: true,
    contentType: "image/webp",
  });
  if (error) throw error;
  const { data } = sb.storage.from("org-assets").getPublicUrl(fullPath);
  // Cache-bust since we upsert to the same path
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function seedSampleData(orgId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    const seed = buildSeed(orgId);
    demoTable("vendors").setAll(seed.vendors);
    demoTable("storage_locations").setAll(seed.storage_locations);
    demoTable("inventory_items").setAll(seed.inventory_items);
    demoTable("asset_maintenance").setAll(seed.asset_maintenance);
    demoTable("recipes").setAll(seed.recipes);
    demoTable("recipe_ingredients").setAll(seed.recipe_ingredients);
    demoTable("restaurant_tables").setAll(seed.restaurant_tables);
    demoTable("employees").setAll(seed.employees);
    demoTable("customers").setAll(seed.customers);
    demoTable("purchase_orders").setAll(seed.purchase_orders);
    demoTable("tasks").setAll(seed.tasks);
    demoTable("orders").setAll(seed.orders);
    demoTable("payments").setAll(seed.payments);
    demoTable("expenses").setAll(seed.expenses);
    return;
  }
  const { error } = await getSupabase().rpc("seed_demo_data", { _org: orgId });
  if (error) throw error;
  // Undo any mojibake if this Supabase instance's seed_demo_data was corrupted
  // by pasting UTF-8 into the SQL editor. No-op on clean data; ignored on DBs
  // that predate the repair migration (0005).
  const { error: repairErr } = await getSupabase().rpc("repair_demo_encoding", { _org: orgId });
  if (repairErr && !/does not exist|could not find|not find the function/i.test(repairErr.message)) {
    throw repairErr;
  }
  // Layer on the rest of the feature data (reservations, deliveries, timeclock,
  // marketing, supplier bills/price intel, loyalty history…). Ignored on DBs
  // that predate the seed-extras migration (0009).
  const { error: extrasErr } = await getSupabase().rpc("seed_demo_extras", { _org: orgId });
  if (extrasErr && !/does not exist|could not find|not find the function/i.test(extrasErr.message)) {
    throw extrasErr;
  }
}

export async function acceptInvite(code: string): Promise<string> {
  if (!isSupabaseConfigured) {
    await demoDelay();
    throw new Error("Invites need a connected backend (demo mode)");
  }
  const { data, error } = await getSupabase().rpc("accept_invite", { _code: code });
  if (error) throw error;
  return data as string;
}
