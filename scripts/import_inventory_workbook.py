#!/usr/bin/env python3
"""
Generates a reviewable SQL import script from a filled-in DishData Inventory
Workbook (see: DishData_Inventory_Count_Template.xlsx).

Usage:
    python3 scripts/import_inventory_workbook.py <path-to-xlsx> <org-slug> > import.sql

Then READ import.sql before running it — this script only generates SQL, it
never touches the database itself. Run the reviewed file in the Supabase SQL
editor (same convention as every other migration/seed script in this repo).

Imports, in dependency order (matches supabase/setup.sql's own structure):
  1. Storage Locations  -> storage_locations
  2. Vendors             -> resolved by name, auto-created if missing (defaults
                             from the vendors table cover everything but name)
  3. Kokoland Inventory Count -> inventory_items (location_id/vendor_id resolved
                             from steps 1-2)
  4. Recipes (Dishes)    -> recipes
  5. Recipe Ingredients  -> recipe_ingredients (recipe_id/inventory_item_id
                             resolved from steps 3-4; unmatched inventory item
                             names import as a name-only ingredient line, same
                             as the app allows for ingredients with no stock link)
  6. Asset Maintenance Log -> asset_maintenance (item_id resolved from step 3)

Validation (aborts with a report, generates no SQL, if anything fails):
  - Item Type must be ingredient/supply/equipment
  - Category must be valid for that Item Type (src/views/Inventory.tsx's lists)
  - Recipe Category must be one of Starters/Mains/Sides/Desserts/Drinks
  - Maintenance Kind must be service/repair/inspection
  - Every row needs at least a name
"""
import sys
import datetime
import openpyxl

FOOD_CATEGORIES = {"Produce", "Meat", "Seafood", "Dairy", "Dry Goods", "Beverage"}
SUPPLY_CATEGORIES = {"Packaging", "Supplies", "Cleaning", "Disposables", "Stationery"}
EQUIPMENT_CATEGORIES = {"Equipment", "Machines", "Smallwares", "IT & POS"}
CATEGORY_BY_TYPE = {
    "ingredient": FOOD_CATEGORIES,
    "supply": SUPPLY_CATEGORIES,
    "equipment": EQUIPMENT_CATEGORIES,
}
RECIPE_CATEGORIES = {"Starters", "Mains", "Sides", "Desserts", "Drinks"}
MAINTENANCE_KINDS = {"service", "repair", "inspection"}
DEFAULT_EMOJI = {"Starters": "\U0001F95F", "Mains": "\U0001F37D️", "Sides": "\U0001F957",
                 "Desserts": "\U0001F370", "Drinks": "\U0001F964"}

REFERENCE_MARKERS = ("Real reference", "Starter rows are suggestions", "Format:", "Top rows")


def sql_str(v):
    if v is None or v == "":
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def sql_num(v):
    if v is None or v == "":
        return "null"
    try:
        return str(float(v))
    except (TypeError, ValueError):
        return "null"


def sql_date(v):
    if v is None or v == "":
        return "null"
    if isinstance(v, (datetime.date, datetime.datetime)):
        d = v.date() if isinstance(v, datetime.datetime) else v
        return f"'{d.isoformat()}'"
    return sql_str(v)


def read_rows(ws, start_row, name_col=1, max_scan=500, blank_run_stop=6):
    """Reads rows starting at start_row until a reference-block marker or a
    run of `blank_run_stop` consecutive empty name cells. Skips blank rows
    within the run (so gaps the user leaves don't break the scan early)."""
    rows, blank_run = [], 0
    for r in range(start_row, start_row + max_scan):
        val = ws.cell(row=r, column=name_col).value
        text = str(val).strip() if val is not None else ""
        if text and any(text.startswith(m) for m in REFERENCE_MARKERS):
            break
        if not text:
            blank_run += 1
            if blank_run >= blank_run_stop:
                break
            continue
        blank_run = 0
        rows.append(r)
    return rows


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    path, slug = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(path, data_only=True)
    errors = []

    def cell(ws, r, c):
        return ws.cell(row=r, column=c).value

    # ---- 1. Storage Locations ----
    wsL = wb["Storage Locations"]
    locations = []
    for r in read_rows(wsL, 5):
        locations.append({
            "row": r, "name": cell(wsL, r, 1), "area": cell(wsL, r, 2),
            "shelf": cell(wsL, r, 3), "notes": cell(wsL, r, 4),
        })

    # ---- 2. Inventory (also collects vendor names) ----
    wsI = wb["Kokoland Inventory Count"]
    items, vendor_names = [], set()
    for r in read_rows(wsI, 4):
        name = cell(wsI, r, 1)
        itype = (cell(wsI, r, 2) or "").strip()
        category = (cell(wsI, r, 3) or "").strip()
        vendor = cell(wsI, r, 13)
        if itype not in CATEGORY_BY_TYPE:
            errors.append(f"[Inventory row {r}] '{name}': Item Type must be ingredient/supply/equipment, got '{itype}'")
        elif category and category not in CATEGORY_BY_TYPE[itype]:
            errors.append(f"[Inventory row {r}] '{name}': Category '{category}' isn't valid for item type '{itype}' "
                           f"(valid: {', '.join(sorted(CATEGORY_BY_TYPE[itype]))})")
        if vendor:
            vendor_names.add(str(vendor).strip())
        items.append({
            "row": r, "name": name, "item_type": itype, "category": category,
            "stock": cell(wsI, r, 4), "unit": cell(wsI, r, 5), "par": cell(wsI, r, 7),
            "cost": cell(wsI, r, 8), "location": cell(wsI, r, 11), "sku": cell(wsI, r, 12),
            "vendor": vendor, "expires": cell(wsI, r, 15),
        })

    # ---- 3. Recipes (Dishes) ----
    wsR = wb["Recipes (Dishes)"]
    recipes = []
    for r in read_rows(wsR, 6):
        category = (cell(wsR, r, 2) or "").strip()
        if category not in RECIPE_CATEGORIES:
            errors.append(f"[Recipes row {r}] '{cell(wsR, r, 1)}': Category must be one of "
                           f"{', '.join(sorted(RECIPE_CATEGORIES))}, got '{category}'")
        recipes.append({
            "row": r, "name": cell(wsR, r, 1), "category": category, "price": cell(wsR, r, 3),
            "prep_minutes": cell(wsR, r, 4),
        })

    # ---- 4. Recipe Ingredients ----
    wsG = wb["Recipe Ingredients"]
    links = []
    for r in read_rows(wsG, 6):
        dish = cell(wsG, r, 1)
        if dish and dish not in {x["name"] for x in recipes}:
            errors.append(f"[Recipe Ingredients row {r}] Dish '{dish}' isn't in the Recipes (Dishes) sheet")
        links.append({
            "row": r, "dish": dish, "item": cell(wsG, r, 2), "qty": cell(wsG, r, 3),
            "unit": cell(wsG, r, 4),
        })

    # ---- 5. Asset Maintenance Log ----
    wsA = wb["Asset Maintenance Log"]
    maint = []
    for r in read_rows(wsA, 5):
        kind = (cell(wsA, r, 3) or "").strip()
        equip = cell(wsA, r, 1)
        if kind not in MAINTENANCE_KINDS:
            errors.append(f"[Asset Maintenance row {r}] '{equip}': Kind must be one of "
                           f"{', '.join(sorted(MAINTENANCE_KINDS))}, got '{kind}'")
        if equip and equip not in {x["name"] for x in items if x["item_type"] == "equipment"}:
            errors.append(f"[Asset Maintenance row {r}] '{equip}' isn't listed as an equipment item "
                           f"in the Inventory sheet")
        maint.append({
            "row": r, "equipment": equip, "date": cell(wsA, r, 2), "kind": kind,
            "cost": cell(wsA, r, 4), "note": cell(wsA, r, 5), "next_due": cell(wsA, r, 6),
        })

    if errors:
        sys.stderr.write(f"Found {len(errors)} problem(s) — no SQL generated:\n\n")
        for e in errors:
            sys.stderr.write(f"  - {e}\n")
        sys.exit(1)

    sys.stderr.write(
        f"Validated OK: {len(locations)} locations, {len(items)} inventory items "
        f"({len(vendor_names)} distinct vendors), {len(recipes)} recipes, {len(links)} "
        f"ingredient links, {len(maint)} maintenance entries.\n"
    )

    # ---- generate SQL ----
    out = []
    out.append(f"-- Generated by scripts/import_inventory_workbook.py from {path}")
    out.append(f"-- Target org slug: {slug}")
    out.append("-- REVIEW BEFORE RUNNING. Wrapped in a transaction — nothing commits until the end.")
    out.append("begin;")
    out.append("do $$")
    out.append("declare")
    out.append("  _org uuid;")
    for i in range(len(locations)):
        out.append(f"  loc_{i} uuid;")
    for name in sorted(vendor_names):
        out.append(f"  vend_{abs(hash(name)) % 100000} uuid; -- {name}")
    for i in range(len(items)):
        out.append(f"  item_{i} uuid;")
    for i in range(len(recipes)):
        out.append(f"  recipe_{i} uuid;")
    out.append("begin")
    out.append(f"  select id into _org from orgs where slug = {sql_str(slug)};")
    out.append("  if _org is null then raise exception 'org not found: %', " + sql_str(slug) + "; end if;")
    out.append("")

    out.append("  -- 1. Storage Locations")
    for i, loc in enumerate(locations):
        out.append(
            f"  insert into storage_locations (org_id, name, area, shelf, notes) values "
            f"(_org, {sql_str(loc['name'])}, {sql_str(loc['area'])}, {sql_str(loc['shelf'])}, "
            f"{sql_str(loc['notes'])}) returning id into loc_{i};"
        )
    out.append("")

    if vendor_names:
        out.append("  -- 2. Vendors (resolved by name, created if missing — defaults cover everything but name)")
        for name in sorted(vendor_names):
            var = f"vend_{abs(hash(name)) % 100000}"
            out.append(f"  select id into {var} from vendors where org_id = _org and name = {sql_str(name)};")
            out.append(f"  if {var} is null then")
            out.append(f"    insert into vendors (org_id, name) values (_org, {sql_str(name)}) returning id into {var};")
            out.append("  end if;")
        out.append("")

    loc_by_name = {loc["name"]: i for i, loc in enumerate(locations)}
    out.append("  -- 3. Inventory Items")
    for i, it in enumerate(items):
        loc_var = f"loc_{loc_by_name[it['location']]}" if it["location"] in loc_by_name else "null"
        vend_var = f"vend_{abs(hash(str(it['vendor']).strip())) % 100000}" if it["vendor"] else "null"
        stock_sql = sql_num(it["stock"]) if it["stock"] not in (None, "") else "0"
        unit_sql = sql_str(it["unit"]) if it["unit"] else sql_str("pc")
        out.append(
            f"  insert into inventory_items (org_id, name, category, item_type, stock, unit, "
            f"par_level, unit_cost, location_id, sku, vendor_id, expires_at) values "
            f"(_org, {sql_str(it['name'])}, {sql_str(it['category'])}, {sql_str(it['item_type'])}, "
            f"{stock_sql}, {unit_sql}, "
            f"{sql_num(it['par'])}, {sql_num(it['cost'])}, {loc_var}, {sql_str(it['sku'])}, {vend_var}, "
            f"{sql_date(it['expires'])}) returning id into item_{i};"
        )
    out.append("")

    out.append("  -- 4. Recipes (Dishes)")
    for i, rec in enumerate(recipes):
        emoji = DEFAULT_EMOJI.get(rec["category"], "\U0001F37D️")
        out.append(
            f"  insert into recipes (org_id, name, category, price, prep_minutes, emoji, is_active) values "
            f"(_org, {sql_str(rec['name'])}, {sql_str(rec['category'])}, {sql_num(rec['price']) if rec['price'] not in (None,'') else '0'}, "
            f"{sql_num(rec['prep_minutes']) if rec['prep_minutes'] not in (None,'') else '10'}, {sql_str(emoji)}, true) "
            f"returning id into recipe_{i};"
        )
    out.append("")

    if links:
        recipe_by_name = {r["name"]: i for i, r in enumerate(recipes)}
        item_by_name = {it["name"]: i for i, it in enumerate(items)}
        out.append("  -- 5. Recipe Ingredients (unmatched inventory items import as a name-only line, no stock link)")
        for link in links:
            if not link["dish"] or not link["item"]:
                continue
            recipe_var = f"recipe_{recipe_by_name[link['dish']]}"
            item_var = f"item_{item_by_name[link['item']]}" if link["item"] in item_by_name else "null"
            out.append(
                f"  insert into recipe_ingredients (org_id, recipe_id, inventory_item_id, name, "
                f"qty_display, qty_numeric, cost) values "
                f"(_org, {recipe_var}, {item_var}, {sql_str(link['item'])}, "
                f"{sql_str(link['qty'])}, {sql_num(link['qty']) if isinstance(link['qty'], (int, float)) else '0'}, 0);"
            )
        out.append("")

    if maint:
        item_by_name = {it["name"]: i for i, it in enumerate(items)}
        out.append("  -- 6. Asset Maintenance Log")
        for m in maint:
            if not m["equipment"]:
                continue
            item_var = f"item_{item_by_name[m['equipment']]}"
            out.append(
                f"  insert into asset_maintenance (org_id, item_id, performed_at, kind, cost, note, next_due_at) "
                f"values (_org, {item_var}, {sql_date(m['date'])}, {sql_str(m['kind'])}, "
                f"{sql_num(m['cost']) if m['cost'] not in (None,'') else '0'}, {sql_str(m['note'])}, {sql_date(m['next_due'])});"
            )
        out.append("")

    out.append("end $$;")
    out.append("commit;")
    print("\n".join(out))


if __name__ == "__main__":
    main()
