// Parser for the per-year AOPD spreadsheets.
//
// Shared by scripts/import-spreadsheets.ts (writes) and scripts/compare-excel.ts
// (read-only). Kept in one place so the comparison can never disagree with the
// import because of a subtly different parser — which would make a comparison
// worse than useless.
//
// Model notes, derived from the AOPD formulas:
//  - Operating Expenses = SUM(categories) − Benefits. "Benefits" is credits and
//    refunds, i.e. money IN, so it's treated as income. Modelling it this way is
//    what makes NOI, cash flow and taxable income match the sheet.
//  - Sub-items ("- Home Owners", "- Electricity") belong to the category above
//    them; the parent's own row is only a sum and is skipped.
//  - Excluded items are parsed out of "*… ignore / first month / not counting"
//    notes and marked countsTowardCost=false.
import ExcelJS from "exceljs";

/** Parents whose row is only a sum of sub-items; use the children instead. */
export const PARENTS_WITH_CHILDREN = new Set([
  "Insurance",
  "Lawn",
  "Taxes",
  "Utilities",
]);

/** Note language marking an amount as tracked-but-excluded. */
export const EXCLUDE_RE = /ignore|not going to count|not\s+count|first month/i;

type ExcelVal = ExcelJS.CellValue;

export function num(v: ExcelVal): number | null {
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

export function str(v: ExcelVal): string {
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

export function normalizeCategory(label: string): string {
  const c = label.replace(/^[-\s]+/, "").trim();
  if (/^Repairs and Maintan?ence$/i.test(c)) return "Repairs and Maintenance";
  return c;
}

export interface Entry {
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

export interface YearParse {
  year: number;
  entries: Entry[];
  benefits: number;
  grossRent: number;
  otherIncome: number;
  sumCategories: number; // counted operating expenses (Σ categories)
  aopdOperatingExpenses: number | null;
  aopdNOI: number | null;
}

export function ymd(y: number, m1: number, d = 1): Date {
  return new Date(Date.UTC(y, m1 - 1, d));
}

export function parseYear(
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
  const at = (pred: (l: string) => boolean) => rows.find((x) => pred(x.label));

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
  const months = monthlyRent > 0 ? Math.round(grossRent / monthlyRent) : 0;
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

export interface TripParse {
  date: Date;
  source: string | null;
  destination: string | null;
  reason: string | null;
  miles: number;
}

/** Read the Travel tab. Returns [] if the workbook has no such sheet. */
export function parseTravel(wb: ExcelJS.Workbook): TripParse[] {
  const ws = wb.getWorksheet("Travel");
  if (!ws) return [];
  const trips: TripParse[] = [];
  const maxRow = ws.rowCount || 60;
  for (let r = 2; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const dateVal = row.getCell(1).value;
    const miles = num(row.getCell(5).value);
    // Skip the "Total" row and anything without a real date.
    if (!(dateVal instanceof Date)) continue;
    if (miles == null || miles <= 0) continue;
    trips.push({
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
    });
  }
  return trips;
}

/** Year from a filename like "30831 Mitdown Ct (2024).xlsx". */
export function yearFromFilename(file: string): number | null {
  const m = file.match(/\((\d{4})\)/);
  return m ? Number(m[1]) : null;
}
