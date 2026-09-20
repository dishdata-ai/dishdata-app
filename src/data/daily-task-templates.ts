// Kokoland's daily checklists. Single source for the demo seed (seed.ts) and the
// SQL in supabase/migrations/0056 — keep the two in step when editing.

import type { Task } from "@/lib/api/database.types";

export interface DailyTemplate {
  title: string;
  description: string;
  role: Task["assigned_role"];
  department: Task["department"];
  priority: Task["priority"];
  steps: string[];
  /** Needs a photo of the finished work before it can be ticked. */
  photo: boolean;
}

const mains = ["Beef curry", "Chicken curry", "Paneer butter masala", "Veg stew"];
const drinks = ["Coconut Thunder", "Pina Colada", "Lemonades with Naruneendi"];

const t = (
  title: string,
  description: string,
  role: Task["assigned_role"],
  department: Task["department"],
  priority: Task["priority"] = "medium",
  steps: string[] = [],
  photo = false,
): DailyTemplate => ({ title, description, role, department, priority, steps, photo });

const FOH = "front_of_house" as const;
const K = "kitchen" as const;

export const DAILY_TEMPLATES: DailyTemplate[] = [
  // Frontend — opening
  t("Front-of-house open check", "Lights, music, card terminal and till float ready", "frontend", FOH, "high"),
  t("Guest area setup", "Wipe tables, set cutlery caddies, check takeaway packing stock (boxes, bags, lids)", "frontend", FOH),
  // Frontend — service
  t("Prepare drinks", "Coconut Thunder, Pina Colada and lemonades with Naruneendi ready to serve", "frontend", FOH, "high", drinks),
  t("Prepare cocktails", "All cocktail ingredients, garnishes and glasses ready", "frontend", FOH),
  t("Pack main dishes", "Take mains from the bain-marie and pack for takeaway", "frontend", FOH, "high", mains),
  t("Rice and heating", "Rice cooked and kept hot; heat dishes before serving", "frontend", FOH, "high"),
  t("Check drink stock (5+ portions)", "Always at least 5 portions of each drink ready", "frontend", FOH, "high", drinks),
  t("Check cutlery, plates & glasses", "Enough cutlery, main plates and glasses at the front", "frontend", FOH, "high", ["Cutlery", "Main plates", "Glasses"]),
  t("Check front inventory", "Enough of the front-line staples before service", "frontend", FOH, "high", ["Porotta", "Coconut milk", "Oil", "Ketchup"]),
  t("Inventory in its proper place", "Every inventory item stored in its labelled location, easy for anyone to find", "frontend", FOH),
  t("Allergen & label check", "Allergen info and labels match today's dishes", "frontend", FOH),
  // Frontend — cleaning
  t("Clean front desk & tables", "Front desk, tables and under the tables", "frontend", FOH, "medium", [], true),
  t("Clean floors", "Sweep and mop the guest area", "frontend", FOH, "medium", [], true),
  t("Clean guest toilets & urinals", "Toilets, urinals, sinks and floor", "frontend", FOH, "high", [], true),
  t("Check tissue & toilet paper", "Tissue and toilet paper stocked in every restroom", "frontend", FOH),
  t("Clean mirrors", "Front area and restroom mirrors", "frontend", FOH, "low"),
  // Frontend — closing
  t("Close till", "Count and close the till, complete the end-of-day cash out", "frontend", FOH, "high"),
  t("Lock-up check", "Lights off, doors, windows and card terminal closed", "frontend", FOH),
  // Kitchen lead / head chef
  t("Chiller & bain-marie temperature log", "Record every chiller, freezer and the bain-marie; flag anything out of range", "kitchen_lead", K, "high"),
  t("Cooked dish locations", "Each cooked dish is in its assigned chiller; note which chiller holds which item", "kitchen_lead", K, "high", mains),
  t("Label cooked dishes (FIFO)", "Date and label every cooked dish before it goes in the chiller", "kitchen_lead", K, "high"),
  t("Recipe check", "Every dish cooked to its recipe; recipes in DishData complete and current", "kitchen_lead", K),
  t("Prep list for the day", "Set prep quantities per dish from recent sales", "kitchen_lead", K),
  t("Delivery check", "Check incoming goods for quantity, damage and expiry before signing", "kitchen_lead", K),
  t("Waste log", "Record what was thrown away and why", "kitchen_lead", K, "low"),
  // Commi / kitchen helper
  t("Clean kitchen floors", "Sweep and mop all kitchen floors", "commi_kitchen", K, "high", [], true),
  t("Wash dishes", "All dishes washed, sink area clean", "commi_kitchen", K, "high"),
  t("Check bain-marie stock (5+ portions)", "At least 5 portions of each main dish in the bain-marie", "commi_kitchen", K, "high", mains),
  t("Check curry plates", "Enough curry plates ready for service", "commi_kitchen", K, "high"),
  t("Hand-wash station check", "Soap, paper towels and hot water at every sink", "commi_kitchen", K, "low"),
  t("Bins and trash out", "Empty all bins, take waste out, replace liners", "commi_kitchen", K),
  t("Equipment off", "Grill, stove, fryer and extractor off; gas closed", "commi_kitchen", K, "high"),
  // Cleaning — assignee decided later. Managers attach an example photo per task; doers upload proof.
  t("Clean grill", "Grill surface and grates; match the example photo", null, K, "high", ["Scrape grates", "Degrease surface", "Wipe outside"], true),
  t("Clean stove", "Burners, hob and surrounding wall; match the example photo", null, K, "high", ["Remove and wash burner caps", "Degrease hob", "Wipe wall and knobs"], true),
  t("Clean work table between stations", "Work table in between stations; match the example photo", null, K, "medium", ["Clear the table", "Scrub and sanitise", "Dry and reset"], true),
  t("Clean employee toilet", "Toilet, sink, floor and supplies", null, FOH, "medium", [], true),
];
