# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev                        # dev server on :3000
npm run build                      # production build (also the type check — there is no separate tsc script)
npm run lint                       # eslint (flat config, eslint-config-next)

npm run db:push                    # apply schema.prisma to SQLite (no migrations dir — db push only)
npm run db:seed                    # seed category taxonomy only (generic, committed)
npx tsx prisma/seed.local.ts       # seed the real property + figures (git-ignored, may not exist)
npm run db:studio                  # browse the DB

npm run import                     # import per-year "... (YYYY).xlsx" from $RENTAL_XLSX_DIR
npx tsx scripts/import-spreadsheets.ts "/path/to/folder"
```

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
truth), `/projection` NPV/IRR/MIRR + assumptions.

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

- `prisma/dev.db`, `.env`, `prisma/seed.local.ts`, `*.local.ts`, and all spreadsheets
  (`*.xlsx`, `*.csv`, …) are git-ignored.
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

Local-first but Vercel-ready: switch the Prisma datasource `provider` from `sqlite` to
`postgresql` and point `DATABASE_URL` at hosted Postgres. No app-code changes.
