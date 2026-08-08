-- ============================================================================
-- 0030 · German translations for the public menu (AI-generated, cached on
-- the recipe row so the storefront never calls the translation API live).
-- ============================================================================

alter table public.recipes add column if not exists name_de text;
alter table public.recipes add column if not exists description_de text;
alter table public.recipes add column if not exists category_de text;
