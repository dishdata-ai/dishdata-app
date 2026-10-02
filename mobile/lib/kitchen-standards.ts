// Kokoland's kitchen production plan: how each component is made, held and finished.
// Single source for the demo seed and supabase/migrations/0059 — keep the two in step.
//
// Built from the SumUp sales export (26 Aug – 19 Sep 2026) and the Kokoland Kitchen
// Efficiency workbook: the component list, methods, opening coverage, reorder points
// and batch sizes come from that analysis. Portion sizes, times and holding limits are
// STARTING ESTIMATES — the chef confirms them on Kitchen Ops → Menu & methods.
// Holding rules follow the usual German guidance (hot-hold at 65 °C or above, a few
// hours at most); set final limits in your own HACCP plan.

export type ProdMethod = "hot_hold" | "fridge_reheat" | "pan_finish" | "fresh" | "batch_portion" | "assembly";

export const METHODS: { id: ProdMethod; label: string; short: string; how: string }[] = [
  { id: "hot_hold", label: "Batch Cook + Hot Hold", short: "Hot hold", how: "Cook a small batch, keep it hot, serve straight from it. Keep a chilled backup for rapid reheat." },
  { id: "fridge_reheat", label: "Batch Cook + Refrigerate + Reheat", short: "Chill & reheat", how: "Cook a batch, chill fast, portion, reheat portions when ordered." },
  { id: "pan_finish", label: "Pre-cook + Finish in Pan", short: "Pan finish", how: "Cook and portion ahead, finish each order in a hot pan for texture." },
  { id: "fresh", label: "Cook/Fry Fresh to Order", short: "Fresh to order", how: "Prep, marinate or pre-make ahead, but fry/cook only when the order arrives." },
  { id: "batch_portion", label: "Batch Prepare + Portion", short: "Batch & portion", how: "Prepare components in batches, portion them, finish quickly to order." },
  { id: "assembly", label: "Assembly Only", short: "Assembly", how: "Everything is ready — just plate and serve." },
];

export const STATIONS = ["curry", "pan", "fryer", "tawa", "steam", "rice", "cold"] as const;
export type Station = (typeof STATIONS)[number];

export const STATION_LABELS: Record<Station, string> = {
  curry: "Curry pots", pan: "Pan / roast", fryer: "Fryer", tawa: "Tawa", steam: "Steamer", rice: "Rice & biriyani", cold: "Cold / assembly",
};

/** Stove-based stations (for "stove load"), and the chef's stations (the rest is helper work). */
export const STOVE_STATIONS: Station[] = ["curry", "pan", "tawa"];
export const CHEF_STATIONS: Station[] = ["curry", "pan", "fryer", "tawa"];

export type BainMarie = "yes" | "limited" | "no";

export interface DishStandard {
  dish: string;
  /** Comma-separated lowercase fragments: an order line containing one uses a portion of this dish (so "Porotta with Beef Curry" counts for both). */
  terms: string;
  method: ProdMethod;
  bain_marie: BainMarie;
  /** Share of the expected demand to have ready at opening (the rest is made during service). */
  open_pct: number;
  portion: string;
  portion_g: number | null;
  /** Bought frozen: cooked from frozen, and the second stock count is the freezer, not prepped food. */
  frozen: boolean;
  station: Station;
  container: string;
  /** Portions per normal batch / replenishment. */
  batch_portions: number;
  /** Floor: never let usable portions drop below this while serving. */
  min_portions: number;
  /** Start preparing/reheating when usable portions reach this. */
  reorder_at: number;
  prep_minutes: number;
  finish_minutes: number;
  target_wait_min: number;
  hold_temp_c: number | null;
  max_hold_min: number | null;
  notes: string;
}

const d = (
  dish: string, terms: string, method: ProdMethod, bain: BainMarie, openPct: number, station: Station,
  container: string, batch: number, min: number, reorder: number, prep: number, finish: number, wait: number,
  hold: number | null, maxHold: number | null, notes: string,
): DishStandard => ({
  dish, terms, method, bain_marie: bain, open_pct: openPct, portion: "1 serving", portion_g: null, frozen: false, station, container,
  batch_portions: batch, min_portions: min, reorder_at: reorder, prep_minutes: prep, finish_minutes: finish,
  target_wait_min: wait, hold_temp_c: hold, max_hold_min: maxHold, notes,
});

export const KITCHEN_STANDARDS: DishStandard[] = [
  d("Porotta", "porotta,parotta", "hot_hold", "no", 1, "tawa", "Covered hot tray", 8, 2, 4, 8, 1, 3, 65, 90, "Bought frozen: cook from frozen in rolling mini-batches of 8 and count the freezer too. Confirm pieces per serving with the chef."),
  d("Chicken Curry", "chicken curry,chicken mix", "hot_hold", "yes", 0.7, "curry", "GN 1/3", 4, 1, 2, 45, 1, 3, 65, 180, "Small live batch; chilled backup; rapid reheat before hot holding."),
  d("Puttu", "puttu", "batch_portion", "no", 1, "steam", "Portion cups", 2, 1, 1, 15, 8, 9, 65, 20, "Pre-portion flour and coconut; steam fresh to order."),
  d("Beef Roast", "beef roast", "pan_finish", "no", 1, "pan", "Portion tray", 4, 1, 2, 75, 4, 8, 65, 30, "Pre-cook and portion; finish and reduce in the pan for texture."),
  d("Chicken Biriyani", "chicken biriyani,chicken biryani", "hot_hold", "limited", 0.85, "rice", "GN / insulated pot", 4, 1, 2, 75, 2, 4, 65, 120, "Plan batches; never the whole day at once; protect rice texture."),
  d("Gobi Manchurian", "gobi", "fresh", "no", 1, "fryer", "Prep tray", 3, 1, 1, 20, 6, 8, null, null, "Pre-prep florets and sauce; fry/toss fresh."),
  d("Beef Curry", "beef curry,beef mix", "hot_hold", "yes", 0.7, "curry", "GN 1/3", 3, 1, 2, 90, 1, 3, 65, 180, "Good bain-marie candidate; avoid holding the whole day's batch."),
  d("Beef Fry / Dry Fry", "beef fry,beef dry fry,dry fry", "pan_finish", "no", 1, "pan", "Portion tray", 4, 1, 2, 60, 4, 8, 65, 30, "Do not bain-marie; finish dry in the pan."),
  d("Kadala Curry", "kadala", "hot_hold", "yes", 0.7, "curry", "GN 1/3", 3, 1, 1, 60, 1, 3, 65, 180, "Stable small-batch hot-hold candidate. Soak chickpeas the night before."),
  d("Paneer Butter Masala", "paneer butter masala", "hot_hold", "yes", 0.65, "curry", "GN 1/3", 3, 1, 2, 35, 1, 3, 65, 120, "Smaller live batch to protect paneer texture."),
  d("Veg Kurma", "kurma,kuruma", "hot_hold", "yes", 0.65, "curry", "GN 1/3", 2, 1, 1, 35, 1, 3, 65, 120, "Keep the batch small because demand is lower."),
  d("Pazhampori", "pazhampori,pazham pori,banana fritters", "fresh", "no", 1, "fryer", "Prep tray", 4, 1, 2, 15, 5, 8, null, null, "Prep fruit and batter; fry fresh."),
  d("Chicken Cutlet", "cutlet", "fresh", "no", 1, "fryer", "Portion tray", 3, 1, 1, 30, 5, 8, null, null, "Pre-made; fry or reheat to order. Count ready portions before the rush."),
  d("Chicken 65", "chicken 65", "fresh", "no", 1, "fryer", "Portion tray", 3, 1, 1, 30, 6, 8, null, null, "Marinate and portion ahead; keep ready-to-fry portions; never hold fried chicken."),
  d("Onion Pakoda", "onion pakoda", "fresh", "no", 1, "fryer", "Prep tray", 3, 1, 1, 15, 6, 8, null, null, "Prepare enough mix for the next rush; fry to order."),
  d("Paneer Biriyani", "paneer biriyani,paneer biryani", "hot_hold", "limited", 0.85, "rice", "GN 1/2", 3, 1, 1, 60, 2, 4, 65, 120, "Smaller batch than chicken biriyani."),
  d("Rice", "rice", "hot_hold", "limited", 0.8, "rice", "Rice hot-hold container", 3, 1, 1, 30, 1, 2, 65, 180, "Cook a fresh pot every couple of hours rather than one huge batch. Set limits in your HACCP plan."),
  d("Paneer Chilli", "paneer chilli", "fresh", "no", 1, "pan", "Prep tray", 2, 1, 1, 20, 5, 8, null, null, "Finish fresh for texture."),
  d("Salad", "salad", "assembly", "no", 1, "cold", "Cold GN", 2, 1, 1, 10, 2, 3, null, null, "Keep components cold and portioned."),
  d("Chicken 65 Biriyani", "chicken 65 biriyani", "hot_hold", "limited", 0.85, "rice", "GN + tray", 2, 1, 1, 75, 6, 8, 65, 120, "Keep the fried component separate until service."),
  d("Dessert", "pudding,payasam", "batch_portion", "no", 1, "cold", "Cold container", 3, 1, 1, 30, 1, 2, null, null, "Count portions before service."),
  d("Fried Chicken Biriyani", "fried chicken biriyani", "hot_hold", "limited", 0.85, "rice", "GN + tray", 3, 1, 1, 75, 6, 8, 65, 120, "Control the rice batch; finish the chicken component to order."),
  d("Uzhunnuvada", "uzhunnuvada", "fresh", "no", 1, "fryer", "Freezer tray", 2, 1, 1, 0, 6, 8, null, null, "Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked."),
  d("Parippuvada", "parippuvada,paripuvada", "fresh", "no", 1, "fryer", "Freezer tray", 2, 1, 1, 0, 6, 8, null, null, "Bought frozen: fry from frozen to order — no prep, just keep the freezer stocked."),
  d("Pathiri", "pathiri", "fresh", "no", 1, "tawa", "Freezer tray", 4, 1, 2, 0, 4, 6, null, null, "Bought frozen: heat on the tawa to order."),
  d("Chicken Roll", "chicken roll", "assembly", "no", 1, "cold", "Prep tray", 2, 1, 1, 20, 4, 6, null, null, "Keep filling and wraps ready; finish to order."),
];

/** Items bought frozen (more to come from the chef — extend this list). */
const FROZEN = new Set(["Porotta", "Uzhunnuvada", "Parippuvada", "Pathiri"]);
for (const x of KITCHEN_STANDARDS) x.frozen = FROZEN.has(x.dish);
