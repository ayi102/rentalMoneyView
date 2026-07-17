/**
 * Import the existing per-year AOPD spreadsheets into the database.
 *
 * Runs 100% locally: it reads the .xlsx files from a folder you point it at and
 * writes to the local SQLite DB. No personal figures are hardcoded here — every
 * number comes from your files at runtime.
 *
 * Usage:
 *   RENTAL_XLSX_DIR="/path/to/folder" npx tsx scripts/import-spreadsheets.ts
 *   # or
 *   npx tsx scripts/import-spreadsheets.ts "/path/to/folder"
 *
 * The folder should contain files named like "... (2022).xlsx", one per year,
 * each with an "AOPD" sheet (and optionally a "Travel" sheet for mileage).
 *
 * Model notes (derived from the AOPD formulas):
 *  - Operating Expenses = SUM(categories) − Benefits. "Benefits" is credits/refunds
 *    (card bonuses, appliance refunds), i.e. money IN — so it's imported as income.
 *    Modeling it this way makes NOI / cash flow / taxable income match the sheet.
 *  - Sub-items (e.g. "- Home Owners", "- Electricity") are imported under their
 *    parent category; the parent's own row is just a sum and is skipped.
 *  - Excluded items are parsed from "*… ignore / first month / not counting" notes
 *    and stored with countsTowardCost=false (they never affect the counted metrics).
 */
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DIR = process.argv[2] || process.env.RENTAL_XLSX_DIR;

// Parents whose row is only a sum of sub-items; import the children instead.
const PARENTS_WITH_CHILDREN = new Set(["Insurance", "Lawn", "Taxes", "Utilities"]);

// Note language that marks an amount as tracked-but-excluded.
const EXCLUDE_RE = /ignore|not going to count|not\s+count|first month/i;

type ExcelVal = ExcelJS.CellValue;

function num(v: ExcelVal): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown };
    if ("result" in o) {
      const r = o.result;
      return typeof r === "number" ? r : Number(r) || null;
    }
    return null;
  }
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function str(v: ExcelVal): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as {
      result?: unknown;
      richText?: { text: string }[];
      text?: string;
    };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if ("text" in o && o.text != null) return String(o.text);
    if ("result" in o) return String(o.result ?? "");
    return "";
  }
  return String(v);
}

function normalizeCategory(label: string): string {
  const c = label.replace(/^[-\s]+/, "").trim();
  if (/^Repairs and Maintan?ence$/i.test(c)) return "Repairs and Maintenance";
  return c;
}

interface Entry {
  date: Date;
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  countsTowardCost: boolean;
  taxDeductible: boolean;
  isCapital: boolean;
}

interface YearParse {
  year: number;
  entries: Entry[];
  benefits: number;
  grossRent: number;
  otherIncome: number;
  sumCategories: number; // my counted operating expenses (Σ categories)
  aopdOperatingExpenses: number | null;
  aopdNOI: number | null;
}

function ymd(y: number, m1: number, d = 1): Date {
  return new Date(Date.UTC(y, m1 - 1, d));
}

function parseYear(
  ws: ExcelJS.Worksheet,
  year: number,
  purchaseDate: Date | null,
): YearParse {
  // Build a label->value map and locate section boundaries.
  const rows: { r: number; label: string; value: number | null; note: string }[] =
    [];
  let expensesHeader = -1;
  let totalOpExRow = -1;
  const maxRow = Math.min(ws.rowCount || 70, 80);
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const note = str(row.getCell(1).value).trim();
    const label = str(row.getCell(2).value).trim();
    const value = num(row.getCell(3).value);
    rows.push({ r, label, value, note });
    if (note === "Expenses") expensesHeader = r;
    if (/^Total: Operating Expenses/i.test(label)) totalOpExRow = r;
  }
  const at = (pred: (l: string) => boolean) =>
    rows.find((x) => pred(x.label));

  const monthlyRent = at((l) => /^Monthly Rent/i.test(l))?.value ?? 0;
  const grossRent = at((l) => /^Gross Scheduled Rent/i.test(l))?.value ?? 0;
  const otherIncome = at((l) => /^Other Income/i.test(l))?.value ?? 0;
  const aopdOperatingExpenses =
    rows.find((x) => x.r === totalOpExRow)?.value ?? null;
  const aopdNOI =
    at((l) => /^Total: Net Operating Income/i.test(l))?.value ?? null;

  // Capital additions live in the "Cash Flow Before Taxes" block, where labels and
  // values are misaligned in this template. Locate the block by its accounting
  // identity instead: NOI − debt service − capital = total cash flow. The block is
  // 5 consecutive value cells [NOI, debtService, capital, amortization, total].
  let capital = 0;
  if (aopdNOI != null) {
    for (let i = 0; i + 4 < rows.length; i++) {
      const noi = rows[i].value;
      const ds = rows[i + 1].value;
      const cap = rows[i + 2].value;
      const total = rows[i + 4].value;
      if (noi == null || ds == null || total == null) continue;
      if (Math.abs(noi - aopdNOI) > 0.5) continue; // this row is the cash-flow NOI
      if (Math.abs(noi - ds - (cap ?? 0) - total) < 0.5) {
        capital = cap ?? 0;
        break;
      }
    }
  }

  // Aggregate date: mid-year, but never before the month after purchase.
  let agg = ymd(year, 7);
  if (purchaseDate && purchaseDate.getTime() > agg.getTime()) {
    agg = ymd(purchaseDate.getUTCFullYear(), purchaseDate.getUTCMonth() + 2);
  }

  const entries: Entry[] = [];

  // ---- Capital additions (reduce cash flow, not NOI) ----
  if (capital > 0) {
    entries.push({
      date: agg,
      kind: "expense",
      category: "Capital Additions",
      subcategory: null,
      amount: capital,
      description: "Capital addition (from AOPD)",
      countsTowardCost: true,
      taxDeductible: false,
      isCapital: true,
    });
  }

  // ---- Income: rent (split monthly), other income ----
  const months =
    monthlyRent > 0 ? Math.round(grossRent / monthlyRent) : 0;
  if (
    months >= 1 &&
    months <= 12 &&
    Math.abs(months * monthlyRent - grossRent) < 1
  ) {
    // place in the last `months` calendar months, not before purchase
    const firstMonth = 12 - months + 1;
    for (let m = firstMonth; m <= 12; m++) {
      const d = ymd(year, m);
      if (purchaseDate && d.getTime() < purchaseDate.getTime()) continue;
      entries.push({
        date: d,
        kind: "income",
        category: "Rent",
        subcategory: null,
        amount: monthlyRent,
        description: "Monthly rent",
        countsTowardCost: true,
        taxDeductible: false,
        isCapital: false,
      });
    }
  } else if (grossRent > 0) {
    entries.push({
      date: agg,
      kind: "income",
      category: "Rent",
      subcategory: null,
      amount: grossRent,
      description: "Annual rent (from AOPD)",
      countsTowardCost: true,
      taxDeductible: false,
      isCapital: false,
    });
  }
  if (otherIncome !== 0) {
    entries.push({
      date: agg,
      kind: "income",
      category: "Other Income",
      subcategory: null,
      amount: otherIncome,
      description: "Other income",
      countsTowardCost: true,
      taxDeductible: false,
      isCapital: false,
    });
  }

  // ---- Expenses (between "Expenses" header and "Total: Operating Expenses") ----
  let benefits = 0;
  let sumCategories = 0;
  let currentParent = "";
  const start = expensesHeader > 0 ? expensesHeader + 1 : 25;
  const end = totalOpExRow > 0 ? totalOpExRow : start + 25;
  for (const row of rows) {
    if (row.r < start || row.r >= end) continue;
    const { label, note } = row;
    const value = row.value ?? 0;
    if (!label) continue;
    const isSub = /^[-\s]*-/.test(label) || label.startsWith("-");
    const category = normalizeCategory(label);

    if (!isSub) currentParent = label;

    // Excluded items parsed from the note (do not affect counted metrics).
    if (note && EXCLUDE_RE.test(note)) {
      const nums = (note.match(/\d+(?:\.\d+)?/g) || [])
        .map(Number)
        .filter((n) => n > 0);
      for (const amt of nums) {
        entries.push({
          date: agg,
          kind: "expense",
          category: normalizeCategory(isSub ? currentParent : label),
          subcategory: null,
          amount: amt,
          description: note,
          countsTowardCost: false,
          taxDeductible: false,
          isCapital: false,
        });
      }
    }

    if (isSub) {
      if (value !== 0 && currentParent) {
        sumCategories += value;
        entries.push({
          date: agg,
          kind: "expense",
          category: normalizeCategory(currentParent),
          subcategory: category,
          amount: value,
          description: null,
          countsTowardCost: true,
          taxDeductible: true,
          isCapital: false,
        });
      }
      continue;
    }

    if (/^Benefits$/i.test(label)) {
      benefits = value; // credit/refund -> imported as income below
      continue;
    }
    if (PARENTS_WITH_CHILDREN.has(label)) continue; // children handle the amount
    if (value !== 0) {
      sumCategories += value;
      entries.push({
        date: agg,
        kind: "expense",
        category,
        subcategory: null,
        amount: value,
        description: null,
        countsTowardCost: true,
        taxDeductible: true,
        isCapital: false,
      });
    }
  }

  // Benefits as income (money in that offsets cost in the sheet).
  if (benefits !== 0) {
    entries.push({
      date: agg,
      kind: "income",
      category: "Benefits",
      subcategory: null,
      amount: benefits,
      description: "Benefits / credits (refunds, bonuses)",
      countsTowardCost: true,
      taxDeductible: false,
      isCapital: false,
    });
  }

  return {
    year,
    entries,
    benefits,
    grossRent,
    otherIncome,
    sumCategories,
    aopdOperatingExpenses,
    aopdNOI,
  };
}

async function importMileage(filePath: string, propertyId: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet("Travel");
  if (!ws) return 0;
  let count = 0;
  const maxRow = ws.rowCount || 60;
  for (let r = 2; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const dateVal = row.getCell(1).value;
    const miles = num(row.getCell(5).value);
    // skip the "Total" row and rows without a real date
    if (!(dateVal instanceof Date)) continue;
    if (miles == null || miles <= 0) continue;
    await prisma.mileageEntry.create({
      data: {
        propertyId,
        date: new Date(
          Date.UTC(
            dateVal.getUTCFullYear(),
            dateVal.getUTCMonth(),
            dateVal.getUTCDate(),
          ),
        ),
        source: str(row.getCell(2).value) || null,
        destination: str(row.getCell(3).value) || null,
        reason: str(row.getCell(4).value) || null,
        miles,
      },
    });
    count++;
  }
  return count;
}

async function main() {
  if (!DIR) {
    console.error(
      "Missing folder. Pass it as an argument or set RENTAL_XLSX_DIR.\n" +
        '  npx tsx scripts/import-spreadsheets.ts "/path/to/xlsx/folder"',
    );
    process.exit(1);
  }
  if (!fs.existsSync(DIR)) {
    console.error(`Folder not found: ${DIR}`);
    process.exit(1);
  }

  const property = await prisma.property.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!property) {
    console.error(
      "No property in the database yet. Run `npx tsx prisma/seed.local.ts` first.",
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && /\(\d{4}\)/.test(f))
    .map((f) => ({
      file: path.join(DIR, f),
      year: Number(f.match(/\((\d{4})\)/)![1]),
    }))
    .sort((a, b) => a.year - b.year);

  if (files.length === 0) {
    console.error(`No "... (YYYY).xlsx" files found in ${DIR}`);
    process.exit(1);
  }

  // Clean slate for this property, then re-import everything.
  await prisma.transaction.deleteMany({ where: { propertyId: property.id } });
  await prisma.mileageEntry.deleteMany({ where: { propertyId: property.id } });

  console.log(`Importing ${files.length} year(s) for "${property.name}"\n`);

  let allOk = true;
  for (const { file, year } of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const ws = wb.getWorksheet("AOPD");
    if (!ws) {
      console.warn(`  ${year}: no AOPD sheet, skipping`);
      continue;
    }
    const p = parseYear(ws, year, property.purchaseDate ?? null);

    for (const e of p.entries) {
      await prisma.transaction.create({
        data: { propertyId: property.id, ...e },
      });
    }

    // Reconcile: my Σcategories should equal AOPD operating expenses + benefits.
    const expectedSum =
      p.aopdOperatingExpenses != null
        ? p.aopdOperatingExpenses + p.benefits
        : null;
    const okExp =
      expectedSum == null ||
      Math.abs(expectedSum - p.sumCategories) < 0.02;
    // my NOI = gross + other + benefits - Σcategories ; compare to AOPD NOI
    const myNOI =
      p.grossRent + p.otherIncome + p.benefits - p.sumCategories;
    const okNOI =
      p.aopdNOI == null || Math.abs(myNOI - p.aopdNOI) < 0.02;
    if (!okExp || !okNOI) allOk = false;

    const counted = p.entries.filter((e) => e.countsTowardCost);
    const excluded = p.entries.filter((e) => !e.countsTowardCost);
    console.log(
      `  ${year}: ${counted.length} counted + ${excluded.length} excluded entries` +
        `  | NOI ${myNOI.toFixed(2)} vs AOPD ${p.aopdNOI?.toFixed(2) ?? "?"} ${okNOI ? "✅" : "❌"}` +
        `  | opEx match ${okExp ? "✅" : "❌"}`,
    );
  }

  // Mileage: the Travel tab is identical across files (the 2022 acquisition
  // trips), so import it once from the earliest file.
  const miles = await importMileage(files[0].file, property.id);
  console.log(`\n  Mileage: ${miles} trips imported from ${files[0].year} file`);

  const totals = await prisma.transaction.count({
    where: { propertyId: property.id },
  });
  console.log(`\nDone. ${totals} transactions total. ${allOk ? "All years reconcile ✅" : "SOME YEARS FAILED ❌"}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
