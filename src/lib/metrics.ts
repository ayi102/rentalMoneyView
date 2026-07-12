import { prisma } from "@/lib/prisma";
import {
  amortizationSchedule,
  computeMetrics,
  monthlyPayment,
  type AmortizationRow,
  type LedgerEntry,
  type PeriodMetrics,
} from "@/lib/finance";
import type { Property, Transaction } from "@prisma/client";

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Dates in this app are calendar dates (no time-of-day meaning), stored as UTC
// midnight. All date math uses UTC getters/setters so a "2025-03-01" entry never
// slips into February in a negative-offset timezone.
function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

function loanTermsOf(p: Property) {
  return {
    purchasePrice: p.purchasePrice,
    downPaymentPct: p.downPaymentPct ?? 0,
    annualRate: p.loanRate ?? 0,
    termYears: p.loanTermYears ?? 0,
  };
}

/** The amortization rows whose payment date falls within calendar `year`. */
function scheduleWindowForYear(p: Property, year: number): AmortizationRow[] {
  if (!p.loanTermYears || !p.purchaseDate) return [];
  const schedule = amortizationSchedule(loanTermsOf(p));
  const firstPayment = addMonths(p.purchaseDate, 1); // first payment ~1 month after close
  return schedule.filter((row) => {
    const payDate = addMonths(firstPayment, row.paymentNumber - 1);
    return payDate.getUTCFullYear() === year;
  });
}

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface MonthlyPoint {
  month: string;
  income: number;
  expense: number; // counted operating + capital
  net: number;
}

export interface ExcludedItem {
  id: string;
  date: Date;
  category: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
}

export interface YearData {
  property: Property;
  year: number;
  availableYears: number[];
  metrics: PeriodMetrics;
  monthlyPayment: number;
  monthly: MonthlyPoint[];
  expenseByCategory: CategoryTotal[];
  excluded: ExcludedItem[];
  transactionCount: number;
}

function toLedgerEntry(t: Transaction): LedgerEntry {
  return {
    kind: t.kind === "income" ? "income" : "expense",
    amount: t.amount,
    countsTowardCost: t.countsTowardCost,
    isCapital: t.isCapital,
    taxDeductible: t.taxDeductible,
  };
}

export async function getDefaultProperty(): Promise<Property | null> {
  return prisma.property.findFirst({ orderBy: { createdAt: "asc" } });
}

export async function getCategories() {
  return prisma.category.findMany({ orderBy: { sortOrder: "asc" } });
}

export async function getTransactionsForYear(
  propertyId: string,
  year: number,
): Promise<Transaction[]> {
  return prisma.transaction.findMany({
    where: {
      propertyId,
      date: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
    orderBy: { date: "desc" },
  });
}

/** Distinct calendar years that have transactions, newest first (always includes current year). */
export async function getAvailableYears(propertyId: string): Promise<number[]> {
  const txns = await prisma.transaction.findMany({
    where: { propertyId },
    select: { date: true },
  });
  const years = new Set<number>(txns.map((t) => t.date.getUTCFullYear()));
  years.add(new Date().getUTCFullYear());
  return [...years].sort((a, b) => b - a);
}

export async function getYearData(
  property: Property,
  year: number,
): Promise<YearData> {
  const txns = await prisma.transaction.findMany({
    where: {
      propertyId: property.id,
      date: {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      },
    },
    orderBy: { date: "asc" },
  });

  const window = scheduleWindowForYear(property, year);
  const metrics = computeMetrics(
    txns.map(toLedgerEntry),
    {
      purchasePrice: property.purchasePrice,
      buildingValuePct: property.buildingValuePct,
      downPaymentPct: property.downPaymentPct ?? 0,
      annualRate: property.loanRate ?? 0,
      termYears: property.loanTermYears ?? 0,
      points: property.points ?? 0,
      closingCosts: property.closingCosts ?? 0,
    },
    12,
    window,
  );

  // Monthly series (counted entries only)
  const monthly: MonthlyPoint[] = MONTH_LABELS.map((m) => ({
    month: m,
    income: 0,
    expense: 0,
    net: 0,
  }));
  for (const t of txns) {
    if (!t.countsTowardCost) continue;
    const idx = t.date.getUTCMonth();
    if (t.kind === "income") monthly[idx].income += t.amount;
    else monthly[idx].expense += t.amount;
  }
  for (const p of monthly) p.net = p.income - p.expense;

  // Expense-by-category (counted, non-capital)
  const catMap = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== "expense" || !t.countsTowardCost || t.isCapital) continue;
    catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amount);
  }
  const expenseByCategory = [...catMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Excluded items (tracked but not counted)
  const excluded: ExcludedItem[] = txns
    .filter((t) => !t.countsTowardCost)
    .map((t) => ({
      id: t.id,
      date: t.date,
      category: t.category,
      subcategory: t.subcategory,
      amount: t.amount,
      description: t.description,
    }));

  return {
    property,
    year,
    availableYears: await getAvailableYears(property.id),
    metrics,
    monthlyPayment: property.loanTermYears ? monthlyPayment(loanTermsOf(property)) : 0,
    monthly,
    expenseByCategory,
    excluded,
    transactionCount: txns.length,
  };
}
