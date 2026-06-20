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

| Tab | What it does |
| --- | --- |
| **My Day** | Shift status, clock in/out, break toggle, hours + earnings, your tasks |
| **POS** | Menu grid by category, cart bottom-sheet, send order to kitchen |
| **Kitchen** | Live ticket board (new → preparing → ready → served), auto-refreshes |
| **Inventory** | Stock levels vs par, low-stock flags, one-tap waste / count |
| **Tasks** | Filterable task list, tap to cycle todo → doing → done |

## Architecture notes

- `lib/types.ts` is a copy of the web app's `src/lib/api/database.types.ts`. Keep them in sync until the shared `packages/core` extraction (Phase 0) lands, at which point both apps import the types from one place.
- The data layer mirrors the web's repo pattern: every function branches on `isSupabaseConfigured`, runs `org_id`-scoped queries against the identical tables, and falls back to the in-memory demo store.
- Verified headless via `npx expo export --platform ios` (full Hermes bundle) + `tsc --noEmit`.

## Not yet built (next phases)

- Native barcode scan (expo-camera) for inventory counts — the key gap vs. web on iOS
- AI bill-capture photo flow (reuses the web `/api/bills/extract` endpoint)
- Push notifications (low stock, new kitchen tickets)
- Offline mutation queue + biometric quick-switch
