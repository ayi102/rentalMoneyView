import { prisma } from "@/lib/prisma";
import {
  amortizationSchedule,
  computeMetrics,
  loanAmount,
  monthlyPayment,
  type AmortizationRow,
  type LedgerEntry,
  type PeriodMetrics,
} from "@/lib/finance";
import type { Property, Transaction } from "@prisma/client";

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
  incomeByCategory: CategoryTotal[];
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

  // Income-by-category (counted). Data is annual, so we summarize by category
  // rather than by month.
  const incMap = new Map<string, number>();
  for (const t of txns) {
    if (t.kind !== "income" || !t.countsTowardCost) continue;
    incMap.set(t.category, (incMap.get(t.category) ?? 0) + t.amount);
  }
  const incomeByCategory = [...incMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

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
    incomeByCategory,
    expenseByCategory,
    excluded,
    transactionCount: txns.length,
  };
}

// ---- All-years / portfolio summary ----------------------------------------

export interface YearRow {
  year: number;
  hasData: boolean;
  income: number;
  operatingExpenses: number;
  capitalExpenses: number;
  excluded: number;
  noi: number;
  interest: number;
  principal: number;
  cashFlow: number | null; // null for years with no recorded transactions
  endingBalance: number;
}

export interface PortfolioSummary {
  property: Property;
  hasLoan: boolean;
  monthlyPayment: number;
  originalLoan: number;
  currentBalance: number; // as of today
  principalPaid: number; // originalLoan - currentBalance (equity built)
  pctPaid: number;
  years: YearRow[];
  // Totals across years that have recorded transactions:
  totalIncome: number;
  totalOperatingExpenses: number;
  totalCapital: number;
  totalExcluded: number;
  totalNoi: number;
  totalInterest: number;
  totalCashFlow: number;
  netPosition: number; // totalCashFlow + principalPaid
  recordedYearCount: number;
}

export async function getPortfolioSummary(
  property: Property,
): Promise<PortfolioSummary> {
  const txns = await prisma.transaction.findMany({
    where: { propertyId: property.id },
    orderBy: { date: "asc" },
  });

  const hasLoan = !!(
    property.loanTermYears &&
    property.purchaseDate &&
    property.loanRate != null
  );
  const terms = loanTermsOf(property);
  const originalLoan = hasLoan ? loanAmount(terms) : 0;

  // Amortization schedule with a UTC calendar date on each payment.
  const firstPayment = property.purchaseDate
    ? addMonths(property.purchaseDate, 1)
    : null;
  const dated = (hasLoan ? amortizationSchedule(terms) : []).map((row) => ({
    ...row,
    date: firstPayment
      ? addMonths(firstPayment, row.paymentNumber - 1)
      : new Date(0),
  }));

  const balanceAsOf = (when: Date): number => {
    if (!hasLoan) return 0;
    const paid = dated.filter((r) => r.date.getTime() <= when.getTime());
    return paid.length ? paid[paid.length - 1].balance : originalLoan;
  };
  // Payments in `year`, but never beyond today — so the current (incomplete) year
  // reflects principal paid *so far*, not a projection of the rest of the year.
  const nowMs = new Date().getTime();
  const windowForYear = (year: number) =>
    dated.filter(
      (r) => r.date.getUTCFullYear() === year && r.date.getTime() <= nowMs,
    );

  const propInputs = {
    purchasePrice: property.purchasePrice,
    buildingValuePct: property.buildingValuePct,
    downPaymentPct: property.downPaymentPct ?? 0,
    annualRate: property.loanRate ?? 0,
    termYears: property.loanTermYears ?? 0,
    points: property.points ?? 0,
    closingCosts: property.closingCosts ?? 0,
  };

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const purchaseYear =
    property.purchaseDate?.getUTCFullYear() ??
    txns[0]?.date.getUTCFullYear() ??
    currentYear;
  const lastTxnYear = txns.length
    ? txns[txns.length - 1].date.getUTCFullYear()
    : currentYear;
  const endYear = Math.max(currentYear, lastTxnYear);

  const byYear = new Map<number, Transaction[]>();
  for (const t of txns) {
    const y = t.date.getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(t);
  }

  const years: YearRow[] = [];
  let totalIncome = 0,
    totalOperatingExpenses = 0,
    totalCapital = 0,
    totalExcluded = 0,
    totalNoi = 0,
    totalInterest = 0,
    totalCashFlow = 0,
    recordedYearCount = 0;

  for (let y = purchaseYear; y <= endYear; y++) {
    const entries = byYear.get(y) ?? [];
    const window = windowForYear(y);
    const m = computeMetrics(entries.map(toLedgerEntry), propInputs, 12, window);
    const hasData = entries.length > 0;

    years.push({
      year: y,
      hasData,
      income: m.grossIncome,
      operatingExpenses: m.operatingExpenses,
      capitalExpenses: m.capitalExpenses,
      excluded: m.excludedTotal,
      noi: m.netOperatingIncome,
      interest: m.mortgageInterest,
      principal: m.mortgagePrincipal,
      cashFlow: hasData ? m.cashFlow : null,
      // Year-end balance, or today's balance for the current (incomplete) year.
      endingBalance: balanceAsOf(
        new Date(Math.min(Date.UTC(y, 11, 31), now.getTime())),
      ),
    });

    if (hasData) {
      totalIncome += m.grossIncome;
      totalOperatingExpenses += m.operatingExpenses;
      totalCapital += m.capitalExpenses;
      totalExcluded += m.excludedTotal;
      totalNoi += m.netOperatingIncome;
      totalInterest += m.mortgageInterest;
      totalCashFlow += m.cashFlow;
      recordedYearCount++;
    }
  }

  const currentBalance = balanceAsOf(now);
  const principalPaid = originalLoan - currentBalance;
  const pctPaid = originalLoan > 0 ? principalPaid / originalLoan : 0;

  return {
    property,
    hasLoan,
    monthlyPayment: hasLoan ? monthlyPayment(terms) : 0,
    originalLoan,
    currentBalance,
    principalPaid,
    pctPaid,
    years,
    totalIncome,
    totalOperatingExpenses,
    totalCapital,
    totalExcluded,
    totalNoi,
    totalInterest,
    totalCashFlow,
    netPosition: totalCashFlow + principalPaid,
    recordedYearCount,
  };
}
