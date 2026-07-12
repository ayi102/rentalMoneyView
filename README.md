# rentalMoneyView

A friendly, at-a-glance view of the full economic outlook for a rental property —
built to replace year-by-year spreadsheets. It's the **source-of-truth ledger**:
log every dollar in and out, but decide per entry what actually counts.

## What it does

- **Dashboard** — cash flow, net operating income, cap rate, cash-on-cash return,
  equity/mortgage, depreciation and taxable income, plus monthly income-vs-expense
  and expense-by-category charts, for any year.
- **Ledger** — add/edit/delete income & expense entries with a category taxonomy.
- **Three per-entry flags** (the heart of the app):
  - **Counts toward cost** — log something for your records but exclude it from real
    cost/profit (the "truth vs. what actually counts" distinction).
  - **Tax deductible** — for the tax view.
  - **Capital vs. operating** — capex is separated from operating expenses.
- The dashboard's "Tracked but not counted" panel shows exactly what you excluded
  and what your cash flow would be if it counted.

## Tech

Next.js (App Router) · TypeScript · Tailwind · Prisma · SQLite · Recharts.
The finance math lives in a pure, tested module (`src/lib/finance.ts`) verified
against real spreadsheet figures (`scripts/check-finance.ts`).

## Getting started

```bash
npm install
npm run db:push     # create the SQLite database from the schema
npm run db:seed     # seed the category taxonomy (safe, no personal data)
npm run dev         # http://localhost:3000
```

### Your data / privacy

- Data lives in a local SQLite file at `prisma/dev.db` — it never leaves your machine.
- `prisma/dev.db`, `.env`, `prisma/seed.local.ts`, and all spreadsheets (`*.xlsx`,
  `*.csv`, …) are **git-ignored** and never committed.
- Your property + real figures are seeded by a git-ignored `prisma/seed.local.ts`
  (run `npx tsx prisma/seed.local.ts`). `prisma/seed.ts` only contains the generic
  category list, so nothing sensitive is ever in version control.

### Importing the existing spreadsheets

`npm run import` reads the per-year `... (YYYY).xlsx` files and populates the database
(replacing prior imported data). It reconciles each year against the sheet's own NOI
and refuses to silently disagree. It runs entirely locally — nothing is uploaded, and
no figures are hardcoded in the code; everything is read from your files at runtime.

```bash
# folder path comes from RENTAL_XLSX_DIR in .env (git-ignored), or pass it explicitly:
npm run import
npx tsx scripts/import-spreadsheets.ts "/path/to/xlsx/folder"
```

Model note: in the AOPD sheet, `Operating Expenses = SUM(categories) − Benefits`, where
"Benefits" is credits/refunds (money in), so the importer records Benefits as income —
which makes NOI, cash flow, and taxable income match the sheet exactly.

### Useful scripts

```bash
npm run db:studio            # browse the database in Prisma Studio
npx tsx scripts/check-finance.ts   # verify the finance engine against known figures
```

## Deploying later (optional)

The app is local-first but structured to deploy to Vercel (free Hobby plan) for phone
access: switch the Prisma datasource from `sqlite` to `postgresql` and point
`DATABASE_URL` at a free hosted Postgres (Neon / Vercel Postgres). No app-code changes.
