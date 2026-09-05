/**
 * Category display order, shared by the public ordering page and the printed
 * menu sheet — both would otherwise fall back to "whatever order recipes
 * happened to be created in," which reads as arbitrary to a diner (dessert
 * before starters, wraps before mains) even though it's deterministic.
 *
 * `explicitOrder` is a restaurant's own choice, saved once in Recipes and
 * reused everywhere the menu is shown. Anything not yet placed in it keeps a
 * sane default — beverages last, as on a normal menu — so a newly-added
 * category doesn't need attention before it can appear at all.
 */
const LAST_BY_DEFAULT = /beverage|drink|getr(ä|ae)nk/i;

export function orderCategories(present: string[], explicitOrder?: string[] | null): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const c of explicitOrder ?? []) {
    if (present.includes(c) && !seen.has(c)) {
      ordered.push(c);
      seen.add(c);
    }
  }
  const rest = present.filter((c) => !seen.has(c));
  const normal = rest.filter((c) => !LAST_BY_DEFAULT.test(c));
  const last = rest.filter((c) => LAST_BY_DEFAULT.test(c));
  return [...ordered, ...normal, ...last];
}
