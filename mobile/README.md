# DishData Mobile

Native staff app for the DishData restaurant platform — Expo (SDK 54) + Expo Router + NativeWind, sharing the same Supabase schema as the web app.

## Stack

- **Expo SDK 54** / React Native 0.81 (new architecture) / React 19 — SDK 54 is the latest version the public Expo Go client supports, so the app runs over the QR-code workflow with no custom dev build
- **Expo Router** — file-based navigation with typed routes
- **NativeWind v4** — Tailwind in RN; theme tokens mirror the web app (`tailwind.config.js` ↔ `src/app/globals.css`)
- **@supabase/supabase-js** — AsyncStorage-backed sessions (vs. the web app's cookie sessions)
- **@tanstack/react-query** — same server-state layer as web

## Run it

```bash
cd mobile
npm install        # already done if you see node_modules/
npx expo start     # press i (iOS sim), a (Android), or scan the QR with Expo Go
```

The app boots in **demo mode** with a seeded dataset (`lib/demo.ts`) — fully explorable with no backend. To connect a real restaurant, copy `.env.example` to `.env` and fill in the **same** Supabase project the web app uses:

```
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

When those are set, the data layer (`lib/api/*`) talks to Supabase with RLS and the seeded demo data is bypassed — exactly the `isSupabaseConfigured` branch pattern the web repos use.

## Screens (staff persona MVP)

Which screens appear follows the website's access switches (Settings → modules, Team & Access): the first four a person can use get a tab, the rest are under **More**.

| Tab | What it does |
| --- | --- |
| **My Day** | Shift status, clock in/out (with the café's location check when one is set) and break toggle, your tasks, your upcoming shifts, your availability for the week, your meal allowance, and your clock-in PIN. First sign-in asks "Who are you?" to link you to your staff record. Hours and earnings show for owners/admins only |
| **My hours** | Your shifts from the last four weeks, by week, with break and worked hours (no pay shown) |
| **More** | Anything that doesn't fit the tab bar, who you're signed in as, and Sign out |
| **POS** | Menu grid by category, cart bottom-sheet, send order to kitchen. **Staff / partner meal** in the order sheet: *My meal* (your own staff allowance, confirmed with your own PIN — free credit, free-drink cap, day-off rate) and, for partners only, *Partner meal* (one of your free meals this month). The price shown is worked out by the same rules the database applies, and checkout errors (wrong PIN, no partner meals left) are shown in the sheet |
| **Kitchen** | **Board** (people with the Kitchen module): live tickets with per-line "ready" taps, a Ready-to-pick-up strip, Still-to-make totals and stage filters. **Kitchen Ops** (people with the Kitchen Ops module): Live Kitchen hot/fridge counters, "cooked +batch" and what to prepare next, plus Today's Prep by weekday — same maths as the website. With only one of the two switched on there's no switcher |
| **Inventory** | Stock levels vs par, low-stock flags, one-tap waste / count |
| **Tasks** | Filterable task list, tap to cycle todo → doing → done. A **Daily** switch (only for people with the Daily Tasks module) shows today's checklists by duty — My duties / Everyone, tick items and steps |

## Architecture notes

- `lib/types.ts` is a copy of the web app's `src/lib/api/database.types.ts`. Keep them in sync until the shared `packages/core` extraction (Phase 0) lands, at which point both apps import the types from one place.
- The data layer mirrors the web's repo pattern: every function branches on `isSupabaseConfigured`, runs `org_id`-scoped queries against the identical tables, and falls back to the in-memory demo store.
- Verified headless via `npx expo export --platform ios` (full Hermes bundle) + `tsc --noEmit`.

## Not yet built (next phases)

- Native barcode scan (expo-camera) for inventory counts — the key gap vs. web on iOS
- AI bill-capture photo flow (reuses the web `/api/bills/extract` endpoint)
- Push notifications (low stock, new kitchen tickets)
- Offline mutation queue + biometric quick-switch

### Not on mobile yet

The website now works well on a phone and installs to the home screen (iPhone: Safari → Share → Add to Home Screen), and it has everything below. Use it for these until they're built natively:

- Claiming a meal **for someone else** (a manager helping a colleague). The mobile till only does *your own* meal; use the website till to claim for another person.
- Taking and uploading the proof photo for a Daily task (the app tells you to add it on the website; items that need one can't be ticked here until then).
- Kitchen Ops' deeper tabs (menu & methods, hourly forecast, service speed, waste, daily/weekly review, standards), Floor, Preorders, Sales Channels, Settings and Team & Access.
