# DishData — Multi-Tenant Restaurant Intelligence SaaS

Customers sign up, create their restaurant workspace, brand it with their logo, and run the
whole operation: POS → kitchen → inventory → insights, with per-user module access controlled
by the admin.

## Stack

- **React 19** + **TypeScript** (strict) on **Vite**
- **Tailwind CSS v4** — CSS-first tokens, dark glassmorphic design, runtime accent-color theming
- **React Router v7** with route-level code splitting
- **Supabase** — Postgres + Auth + RLS multi-tenancy + Storage + Realtime
- **TanStack Query 5** server cache · **Zustand 5** for UI state
- **Demo mode**: with no Supabase credentials the entire app runs on localStorage seed data

## Quick start (demo mode)

```bash
npm install
npm run dev        # http://localhost:8080 — full demo, no backend needed
```

## Connect the real backend (SaaS mode)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the project's **SQL Editor**, paste the whole of `supabase/setup.sql`, run it
   (idempotent — safe to re-run after updates).
3. **Authentication → Providers → Email**: disable "Confirm email" for development.
4. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```
5. Restart `npm run dev`, sign up — the first signup creates your restaurant via the
   onboarding wizard (logo upload, currency, tax, module selection, optional sample data).

### Multi-tenancy & access control

- Every domain table carries `org_id`; Postgres **RLS policies** (via `is_org_member` /
  `has_org_role` SECURITY DEFINER helpers) guarantee isolation between restaurants.
- Roles: owner · admin · manager · staff · accountant · viewer.
- **Team & Access** (`/team`): invite by copy-link code, change roles, and toggle exactly
  which modules each member sees. Role defaults seed automatically on join.
- Org-wide module switches live in **Settings**; per-user access layers on top.

## Modules (22)

Operate: Dashboard, POS (tips, split bill, table picker, delivery address), Kitchen KDS
(realtime tickets, age timers, sound), Floor & Reservations (table grid, QR-code sheets),
Recipes (plate costing, stock-linked ingredients, photos), Inventory (auto-depletion, waste
log, one-click reorder), Procurement (PO pipeline → stock-in trigger), Delivery (courier board).

Grow: Sales, AI Insights (computed live: stockout forecasts, repricing, dead stock, waste
hotspots, revenue forecast), Menu Engineering, Loyalty & CRM (segments + simulated campaigns),
Reports (CSV export).

Money: Finance (live P&L/cash flow), Accounting (expense ledger, tax position), Z-Report
(end-of-day close, printable).

People: Staff, Time Clock (clock in/out, breaks, timesheets), Tasks (kanban with drag &
drop, partner delegation).

Admin: Team & Access, Audit Log, Settings.

**Public storefront** at `/r/<slug>`: branded menu, QR table ordering straight to the kitchen,
and a reservation widget — no login needed.

## Payments & AI upgrades (optional)

- `supabase/functions/{create-payment-intent,confirm-payment}` are ready to deploy; set the
  `STRIPE_SECRET_KEY` function secret to switch the simulated card flow to real Stripe.
- The insight engine is rule-based over live data; an LLM layer can be added as an edge function.

## Scripts

```bash
npm run dev         # dev server (port 8080)
npm run build       # typecheck + production build
npm run typecheck
```
