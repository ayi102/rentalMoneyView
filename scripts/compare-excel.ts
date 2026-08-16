/**
 * Compare the database against the AOPD spreadsheets. READ-ONLY — it opens the
 * .xlsx files and the database and writes to neither.
 *
 *   npm run compare:excel
 *   npx tsx scripts/compare-excel.ts "/path/to/folder"
 *   npx tsx scripts/compare-excel.ts --year 2024      # one year, with detail
 *   npx tsx scripts/compare-excel.ts --all            # show matching lines too
 *
 * Three checks per year:
 *  1. Internal — does the sheet agree with itself? (Σ categories − Benefits vs
 *     the sheet's own "Total: Operating Expenses", and the same for NOI.) A
 *     failure here is a problem in the spreadsheet, not in the app.
 *  2. Totals — income, operating expenses, capital and NOI, sheet vs app.
 *  3. Categories — every category and subcategory, both directions, so a line
 *     present in one and missing from the other is reported rather than ignored.
 *
 * Exit code 1 if anything disagrees, so it can be run as a check.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { parseYear, yearFromFilename, type Entry } from "./lib/aopd";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const yearFlag = args.indexOf("--year");
const onlyYear = yearFlag !== -1 ? Number(args[yearFlag + 1]) : null;
const dirArg = args.find(
  (a, i) => !a.startsWith("--") && args[i - 1] !== "--year",
);
const DIR = dirArg || process.env.RENTAL_XLSX_DIR;

/** Money comparison tolerance, in dollars. */
const TOL = 0.02;

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const near = (a: number, b: number) => Math.abs(a - b) < TOL;

interface Line {
  label: string;
  sheet: number;
  app: number;
}

/** Key a ledger line the same way on both sides. */
function keyOf(category: string, subcategory: string | null): string {
  return subcategory ? `${category} › ${subcategory}` : category;
}

function sumSheetCounted(entries: Entry[], kind: "income" | "expense", capital: boolean) {
  return entries
    .filter(
      (e) =>
        e.kind === kind && e.countsTowardCost && e.isCapital === capital,
    )
    .reduce((s, e) => s + e.amount, 0);
}

async function main() {
  if (!DIR) {
    console.error(
      "No spreadsheet folder. Set RENTAL_XLSX_DIR in .env or pass the path.",
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
    console.error("No property in the database.");
    process.exit(1);
  }

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".xlsx") && yearFromFilename(f) !== null)
    .sort();

  if (files.length === 0) {
    console.error(`No "... (YYYY).xlsx" files in ${DIR}`);
    process.exit(1);
  }

  console.log(`Comparing ${property.name}`);
  console.log(`  spreadsheets: ${DIR}`);
  console.log(`  database:     ${process.env.DATABASE_URL?.split("@")[1] ?? "(local)"}`);
  console.log(`  tolerance:    $${TOL.toFixed(2)}   (read-only — nothing is written)\n`);

  let anyProblem = false;

  for (const file of files) {
    const year = yearFromFilename(file)!;
    if (onlyYear !== null && year !== onlyYear) continue;

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(DIR, file));
    const ws = wb.getWorksheet("AOPD");
    if (!ws) {
      console.log(`${year}  ⚠️  no "AOPD" sheet in ${file}`);
      anyProblem = true;
      continue;
    }

    const p = parseYear(ws, year, property.purchaseDate);

    // --- 1. Does the sheet agree with itself? ---------------------------------
    const sheetOpEx = p.sumCategories - p.benefits;
    const internalOpEx =
      p.aopdOperatingExpenses == null || near(sheetOpEx, p.aopdOperatingExpenses);
    const sheetIncome = p.grossRent + p.otherIncome;
    const derivedNOI = sheetIncome - sheetOpEx;
    const internalNOI = p.aopdNOI == null || near(derivedNOI, p.aopdNOI);

    // --- 2. Sheet vs app totals ----------------------------------------------
    const txns = await prisma.transaction.findMany({
      where: {
        propertyId: property.id,
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    });

    const appIncome = txns
      .filter((t) => t.kind === "income" && t.countsTowardCost)
      .reduce((s, t) => s + t.amount, 0);
    const appOpEx = txns
      .filter((t) => t.kind === "expense" && t.countsTowardCost && !t.isCapital)
      .reduce((s, t) => s + t.amount, 0);
    const appCapital = txns
      .filter((t) => t.isCapital && t.countsTowardCost)
      .reduce((s, t) => s + t.amount, 0);

    // The sheet's income side includes Benefits (credits are money in).
    const sheetIncomeTotal = sumSheetCounted(p.entries, "income", false);
    const sheetOpExTotal = sumSheetCounted(p.entries, "expense", false);
    const sheetCapital = sumSheetCounted(p.entries, "expense", true);

    const totals: Line[] = [
      { label: "Income", sheet: sheetIncomeTotal, app: appIncome },
      { label: "Operating expenses", sheet: sheetOpExTotal, app: appOpEx },
      { label: "Capital", sheet: sheetCapital, app: appCapital },
      {
        label: "NOI",
        sheet: sheetIncomeTotal - sheetOpExTotal,
        app: appIncome - appOpEx,
      },
    ];

    // --- 3. Category by category, both directions ----------------------------
    const sheetByKey = new Map<string, number>();
    for (const e of p.entries) {
      if (!e.countsTowardCost || e.isCapital) continue;
      const k = `${e.kind === "income" ? "+" : "−"} ${keyOf(e.category, e.subcategory)}`;
      sheetByKey.set(k, (sheetByKey.get(k) ?? 0) + e.amount);
    }
    const appByKey = new Map<string, number>();
    for (const t of txns) {
      if (!t.countsTowardCost || t.isCapital) continue;
      const k = `${t.kind === "income" ? "+" : "−"} ${keyOf(t.category, t.subcategory)}`;
      appByKey.set(k, (appByKey.get(k) ?? 0) + t.amount);
    }

    const allKeys = [...new Set([...sheetByKey.keys(), ...appByKey.keys()])].sort();
    const categoryLines: Line[] = allKeys.map((k) => ({
      label: k,
      sheet: sheetByKey.get(k) ?? 0,
      app: appByKey.get(k) ?? 0,
    }));

    const badTotals = totals.filter((l) => !near(l.sheet, l.app));
    const badCategories = categoryLines.filter((l) => !near(l.sheet, l.app));
    const ok =
      internalOpEx && internalNOI && badTotals.length === 0 && badCategories.length === 0;
    if (!ok) anyProblem = true;

    console.log(
      `${year}  ${ok ? "✅ matches" : "❌ differs"}   (${txns.length} app rows, ${p.entries.length} sheet rows)`,
    );

    if (!internalOpEx) {
      console.log(
        `      ⚠️  the SHEET disagrees with itself: Σcategories − Benefits = ${money(sheetOpEx)}, ` +
          `but its "Total: Operating Expenses" says ${money(p.aopdOperatingExpenses!)}`,
      );
    }
    if (!internalNOI) {
      console.log(
        `      ⚠️  the SHEET disagrees with itself: income − opex = ${money(derivedNOI)}, ` +
          `but its "Total: Net Operating Income" says ${money(p.aopdNOI!)}`,
      );
    }

    const show = (lines: Line[], heading: string) => {
      const rows = showAll ? lines : lines.filter((l) => !near(l.sheet, l.app));
      if (rows.length === 0) return;
      console.log(`      ${heading}`);
      console.log(
        `        ${"line".padEnd(34)}${"sheet".padStart(13)}${"app".padStart(13)}${"diff".padStart(13)}`,
      );
      for (const l of rows) {
        const diff = l.app - l.sheet;
        const flag = near(l.sheet, l.app) ? "  " : " ❌";
        console.log(
          `        ${l.label.padEnd(34)}${money(l.sheet).padStart(13)}${money(l.app).padStart(13)}${money(diff).padStart(13)}${flag}`,
        );
      }
    };

    show(totals, "Totals");
    show(categoryLines, "Categories");
    if (!ok || showAll) console.log("");
  }

  console.log(
    anyProblem
      ? "\nSome years differ. Lines marked ❌ are where the app and the sheet disagree."
      : "\nEvery year matches the spreadsheets.",
  );
  process.exit(anyProblem ? 1 : 0);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
