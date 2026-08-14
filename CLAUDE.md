# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev                        # dev server on :3000
npm run build                      # prisma generate && next build (also the type check — no separate tsc script)
npm run lint                       # eslint (flat config, eslint-config-next)

npm run db:deploy                  # apply committed migrations (prisma migrate deploy)
npm run db:migrate                 # create a new migration from schema changes (needs DIRECT_URL)
npm run db:seed                    # seed category taxonomy only (generic, committed)
npx tsx prisma/seed.local.ts       # seed the real property + figures (git-ignored, may not exist)
npm run db:studio                  # browse the DB

npm run db:export                  # dump every row to data/local-dump.json (git-ignored)
npm run db:load                    # load that dump into the current DATABASE_URL

npm run import                     # import per-year "... (YYYY).xlsx" from $RENTAL_XLSX_DIR
npx tsx scripts/import-spreadsheets.ts "/path/to/folder"
```

Requires a `.env` — copy `.env.example`. Four variables matter: `DATABASE_URL`
(pooled, port 6543), `DIRECT_URL` (direct, 5432, migrations only),
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See
[DEPLOY.md](DEPLOY.md).

### Verifying finance changes

There is no test framework. The check is a script that asserts the finance engine
against real spreadsheet figures and exits non-zero on failure:

```bash
npx tsx scripts/check-finance.ts
```

**Run it after any change to [src/lib/finance.ts](src/lib/finance.ts).** It covers monthly
payment, depreciation, an amortization window, NOI / cash flow / taxable income, and
NPV / IRR / MIRR (the last three against known Excel examples). To add a case, add a
`check(label, actual, expected, tol)` line.

## Architecture

Hosted on Vercel with Postgres + Auth on Supabase. Data lives in Postgres; there is
no SQLite anymore (the old `prisma/dev.db` was migrated via `db:export` → `db:load`).

Strictly layered, one direction only:

1. **[src/lib/finance.ts](src/lib/finance.ts)** — pure math. No DB, no framework, no
   `Date`-of-today. Amortization, depreciation, `computeMetrics`, NPV/IRR/MIRR. Keep it
   importable by a plain `tsx` script.
2. **[src/lib/metrics.ts](src/lib/metrics.ts)** — the only place that reads the DB for
   views. Turns Prisma rows into the view models the pages render: `getWorksheetData`,
   `getYearData`, `getPortfolioSummary`, `getProjection`.
3. **`src/app/**/page.tsx`** — async server components, all `export const dynamic = "force-dynamic"`.
   They only format and lay out what layer 2 returns.
4. **Client forms** (`worksheet-form.tsx`, `assumptions-form.tsx`, `year-selector.tsx`,
   chart components) — `"use client"`, hold local state, call server actions, then
   `router.refresh()`.
5. **[src/lib/actions.ts](src/lib/actions.ts)** — every write. `"use server"`, and each
   action must `revalidatePath` all of `/`, `/worksheet`, `/projection`, since all three
   read the same ledger.

Three pages: `/` all-years portfolio, `/worksheet` per-year editable grid (the source of
truth), `/projection` NPV/IRR/MIRR + assumptions. Plus `/login`.

## Auth — where the boundary actually is

The whole app is private. Two layers, and it matters which one is load-bearing:

- **`src/proxy.ts`** (Next 16 renamed Middleware → **Proxy**; it must be named
  `proxy.ts` and sits beside `app/`) redirects signed-out requests to `/login`, keeps
  the Supabase session cookie fresh, and issues the per-request CSP nonce. This is an
  **optimistic pre-filter, not the security boundary** — it runs on prefetches, and
  Next has shipped proxy-bypass advisories before.
- **`requireUser()` in [src/lib/auth.ts](src/lib/auth.ts)** is the real check. **Every
  page and every Server Action calls it.** Server Actions are reachable as HTTP
  endpoints regardless of what the UI renders, so anything that reads or writes data
  without calling it is a hole. It verifies the JWT signature via `getClaims()`
  instead of trusting cookie contents, and is wrapped in React `cache()` so one
  render pass verifies once.

There is no sign-up route by design: the single account is created in the Supabase
dashboard and public sign-ups are disabled there. When adding a page or action, wire
`requireUser()` in as the first line.

Because Prisma connects with database credentials, it bypasses Postgres RLS. That's
fine while every query sits behind `requireUser()` — revisit if a second user or any
browser-side query is ever added.

## The data model and its invariants

Every dollar in or out is one `Transaction` row. Amounts are **always stored positive**;
`kind` (`"income"` | `"expense"`) gives direction. Three flags carry all the meaning:

- `countsTowardCost` — the worksheet's **track toggle**. `false` = kept on record but
  excluded from *every* metric (it only lands in `excludedTotal`). This is the app's
  central idea: log everything, decide per entry what counts.
- `isCapital` — capital addition (appliance, improvement) rather than an operating expense.
- `taxDeductible` — derived on save as `countsTowardCost && kind === "expense" && !isCapital`.

The accounting identities in `computeMetrics` mirror the AOPD spreadsheet and must not
drift:

```
NOI           = counted income − counted non-capital expenses   (capital excluded)
cash flow     = NOI − annual debt service − capital additions
taxable income= NOI − mortgage interest − depreciation
cap rate      = NOI / purchase price                            (capital never affects it)
depreciation  = purchasePrice × buildingValuePct / 27.5
```

Two consequences worth remembering:

- **Capital reduces cash flow but not NOI or cap rate.** Both `finance.ts` and the
  worksheet's live-total math depend on this.
- **"Benefits" (credits, refunds, card bonuses) are imported as income, not negative
  expenses.** The sheet computes `Operating Expenses = SUM(categories) − Benefits`;
  modeling them as income is what makes NOI/cash flow/taxable income match it exactly.
  The importer reconciles each year against the sheet's own NOI and refuses to silently
  disagree.

### Duplicated total logic

`worksheet-form.tsx`'s `totals` useMemo recomputes NOI / cash flow / taxable client-side so
figures update as the user types. It is a hand-mirror of `computeMetrics`. **Change one and
you must change the other**, or the live totals will disagree with what's saved.

### Worksheet save is a whole-year replace

`saveWorksheet` deletes *all* of that year's transactions and recreates them from the
submitted items, inside one `prisma.$transaction`. Zero-amount items are dropped. Entries
are booked at a synthetic mid-year date (Jul 1, or the month after purchase if later) —
dates within a year carry no meaning in this app.

### Categories

The taxonomy lives in the `Category` table. A category is a **container** if another
category names it as `parent` (e.g. Utilities, Insurance) — containers are skipped in the
worksheet because their children carry the amounts. Capital additions are stored under a
synthetic `"Capital Additions"` category with `isCapital: true` and get their own section.
Categories present in data but absent from the taxonomy are still rendered.

### Dates are UTC calendar dates

All dates are calendar dates stored as UTC midnight. **Use UTC getters/setters
everywhere** (`getUTCFullYear`, `setUTCMonth`, `Date.UTC(...)`) so a `2025-03-01` entry
never slips into February in a negative-offset timezone. Amortization assumes the first
payment falls one month after `purchaseDate`; a year's payment window filters on the
payment date's UTC year, and for the current year clamps to payments on or before today so
principal-paid reflects reality rather than a projection.

## Privacy constraints (non-negotiable)

This repo is public-safe; the user's financial data is not. Never commit or hardcode real
figures.

- `.env`, `prisma/seed.local.ts`, `*.local.ts`, `/data/` (which holds `db:export`
  dumps), any `*.db`, and all spreadsheets (`*.xlsx`, `*.csv`, …) are git-ignored.
- `prisma/seed.ts` contains the generic category list only. Real property + figures go in
  the git-ignored `prisma/seed.local.ts`.
- The importer reads every number from the user's files at runtime and writes only to the
  local SQLite DB. Nothing is uploaded.
- `scripts/check-finance.ts` is the one committed file with real numbers in it — they are
  already there as expected values; don't add more.

## Styling

Tailwind v4, CSS-first config — no `tailwind.config.js`. Semantic color tokens
(`background`, `surface`, `foreground`, `muted`, `border`, `accent`, `positive`,
`negative`) are defined in [src/app/globals.css](src/app/globals.css) under `:root` with a
`prefers-color-scheme: dark` override, then exposed via `@theme inline`. Use
`text-positive` / `text-negative` / `bg-surface` etc. rather than raw palette colors, and
`tabular-nums` on figures.

## Deploying

See [DEPLOY.md](DEPLOY.md) for the full Supabase + Vercel checklist. Two details that
bite:

- **Two connection URLs.** Runtime uses the pooled one (6543); `prisma migrate` needs
  the direct one (5432) and will hang on the pooled URL.
- **`prisma generate` must run in the build** (`npm run build` does this). Vercel caches
  `node_modules`, so a `postinstall` hook alone doesn't reliably regenerate the client.
