import { prisma } from "@/lib/prisma";
import {
  amortizationSchedule,
  annualDepreciation,
  computeMetrics,
  irr,
  loanAmount,
  mirr,
  monthlyPayment,
  npv,
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

// ---- Worksheet (editable per-year, AOPD-style category grid) ---------------

export interface WorksheetRow {
  kind: "income" | "expense";
  category: string; // stored category (parent for subs)
  subcategory: string | null;
  label: string; // display label
  amount: number; // current counted sum for the year
  note: string;
}

export interface WorksheetData {
  property: Property;
  year: number;
  availableYears: number[];
  rows: WorksheetRow[];
  // constants for live totals as the user types
  mortgageInterest: number;
  debtService: number;
  depreciation: number;
  monthlyPayment: number;
}

export async function getWorksheetData(
  property: Property,
  year: number,
): Promise<WorksheetData> {
  const [categories, txns] = await Promise.all([
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
    getTransactionsForYear(property.id, year),
  ]);

  // A category is a "container" if other categories name it as parent.
  const parents = new Set(
    categories.filter((c) => c.parent).map((c) => c.parent as string),
  );

  const keyOf = (kind: string, cat: string, sub: string | null) =>
    `${kind}|${cat}|${sub ?? ""}`;

  // Current counted sums + notes per (kind, category, subcategory).
  const sums = new Map<string, number>();
  const notes = new Map<string, string>();
  for (const t of txns) {
    if (!t.countsTowardCost) continue;
    const k = keyOf(t.kind, t.category, t.subcategory);
    sums.set(k, (sums.get(k) ?? 0) + t.amount);
    if (t.description && !notes.get(k)) notes.set(k, t.description);
  }

  const rows: WorksheetRow[] = [];
  const seen = new Set<string>();
  const pushLeaf = (
    kind: "income" | "expense",
    category: string,
    subcategory: string | null,
  ) => {
    const k = keyOf(kind, category, subcategory);
    if (seen.has(k)) return;
    seen.add(k);
    rows.push({
      kind,
      category,
      subcategory,
      label: subcategory ? `${category} › ${subcategory}` : category,
      amount: sums.get(k) ?? 0,
      note: notes.get(k) ?? "",
    });
  };

  // Leaves from the taxonomy, in sort order (income first, then expense).
  for (const kind of ["income", "expense"] as const) {
    for (const c of categories.filter((c) => c.kind === kind)) {
      const isContainer = c.parent === null && parents.has(c.name);
      if (isContainer) continue; // its children carry the amount
      if (c.parent) pushLeaf(kind, c.parent, c.name);
      else pushLeaf(kind, c.name, null);
    }
  }
  // Any (category, subcategory) present in data but not in the taxonomy.
  for (const t of txns) {
    if (!t.countsTowardCost) continue;
    pushLeaf(
      t.kind === "income" ? "income" : "expense",
      t.category,
      t.subcategory,
    );
  }

  const window = scheduleWindowForYear(property, year);
  const mortgageInterest = window.reduce((s, r) => s + r.interest, 0);
  const debtService = window.reduce((s, r) => s + r.payment, 0);

  return {
    property,
    year,
    availableYears: await getAvailableYears(property.id),
    rows,
    mortgageInterest,
    debtService,
    depreciation: annualDepreciation(
      property.purchasePrice,
      property.buildingValuePct,
    ),
    monthlyPayment: property.loanTermYears
      ? monthlyPayment(loanTermsOf(property))
      : 0,
  };
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

// ---- Projection: NPV / IRR / MIRR + value over time -----------------------

export interface ValuePoint {
  year: number;
  value: number; // estimated market value (appreciated)
  balance: number; // loan balance
  equity: number; // value - balance
}

export interface Projection {
  property: Property;
  // assumptions (echoed back for the editable form)
  currentValue: number;
  isEstimatedValue: boolean;
  appreciationRate: number;
  discountRate: number;
  sellingCostRate: number;
  reinvestRate: number;
  financeRate: number;
  // inputs to the return calc
  initialInvestment: number;
  yearsHeld: number;
  purchaseYear: number;
  currentBalance: number;
  sellingCosts: number;
  terminalEquity: number; // net proceeds if sold today
  totalCashFlow: number;
  totalProfitIfSold: number; // terminalEquity + Σcashflow - initialInvestment
  flows: number[];
  cashFlowByYear: { year: number; cashFlow: number }[];
  // results
  npv: number;
  irr: number | null;
  mirr: number | null;
  valueOverTime: ValuePoint[];
}

export async function getProjection(property: Property): Promise<Projection> {
  const summary = await getPortfolioSummary(property);

  const purchaseYear =
    property.purchaseDate?.getUTCFullYear() ?? new Date().getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const yearsHeld = Math.max(1, currentYear - purchaseYear);

  const appreciationRate = property.appreciationRate;
  const discountRate = property.discountRate;
  const sellingCostRate = property.sellingCostRate;
  const reinvestRate = property.reinvestRate;
  const financeRate = property.loanRate ?? discountRate;

  // Current value: explicit override, else purchase price appreciated.
  const estimatedValue =
    property.purchasePrice * Math.pow(1 + appreciationRate, yearsHeld);
  const currentValue = property.currentValue ?? estimatedValue;
  const isEstimatedValue = property.currentValue == null;

  const initialInvestment =
    property.purchasePrice * (property.downPaymentPct ?? 0) +
    (property.points ?? 0) +
    (property.closingCosts ?? 0);

  const currentBalance = summary.currentBalance;
  const sellingCosts = currentValue * sellingCostRate;
  const terminalEquity = currentValue - currentBalance - sellingCosts;

  // Per-year operating cash flows (recorded years; 0 if a year has none).
  const cashFlowByYear = summary.years
    .filter((y) => y.year <= currentYear)
    .map((y) => ({ year: y.year, cashFlow: y.cashFlow ?? 0 }));
  const totalCashFlow = cashFlowByYear.reduce((s, y) => s + y.cashFlow, 0);

  // Flow series: t0 = -initial investment, then each year's cash flow,
  // with the terminal (sale-today) proceeds added to the final year.
  const flows: number[] = [-initialInvestment];
  cashFlowByYear.forEach((y, i) => {
    flows.push(y.cashFlow + (i === cashFlowByYear.length - 1 ? terminalEquity : 0));
  });

  const totalProfitIfSold = terminalEquity + totalCashFlow - initialInvestment;

  // Value over time across the loan term (illustrative, driven by appreciation).
  const term = property.loanTermYears ?? 30;
  const dated = (property.loanTermYears && property.purchaseDate
    ? amortizationSchedule(loanTermsOf(property))
    : []
  ).map((row) => ({
    ...row,
    date: property.purchaseDate
      ? addMonths(addMonths(property.purchaseDate, 1), row.paymentNumber - 1)
      : new Date(0),
  }));
  const originalLoan = summary.originalLoan;
  const balanceAtYearEnd = (y: number): number => {
    if (dated.length === 0) return 0;
    const paid = dated.filter((r) => r.date.getUTCFullYear() <= y);
    return paid.length ? paid[paid.length - 1].balance : originalLoan;
  };
  const valueOverTime: ValuePoint[] = [];
  for (let t = 0; t <= term; t++) {
    const y = purchaseYear + t;
    const value = property.purchasePrice * Math.pow(1 + appreciationRate, t);
    const balance = balanceAtYearEnd(y);
    valueOverTime.push({ year: y, value, balance, equity: value - balance });
  }

  return {
    property,
    currentValue,
    isEstimatedValue,
    appreciationRate,
    discountRate,
    sellingCostRate,
    reinvestRate,
    financeRate,
    initialInvestment,
    yearsHeld,
    purchaseYear,
    currentBalance,
    sellingCosts,
    terminalEquity,
    totalCashFlow,
    totalProfitIfSold,
    flows,
    cashFlowByYear,
    npv: npv(discountRate, flows),
    irr: irr(flows),
    mirr: mirr(flows, financeRate, reinvestRate),
    valueOverTime,
  };
}
