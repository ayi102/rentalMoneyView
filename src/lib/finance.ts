// Pure finance engine for rentalMoneyView.
// No database or framework imports here — just numbers in, numbers out —
// so it's easy to test and reason about. Mirrors the AOPD spreadsheet model.

export const DEPRECIATION_YEARS = 27.5; // US residential rental straight-line
export const IRS_MILEAGE_RATE = 0.7; // $/mile (2025 IRS standard rate)

export interface LoanTerms {
  purchasePrice: number;
  downPaymentPct: number; // e.g. 0.2
  annualRate: number; // e.g. 0.04875
  termYears: number; // e.g. 30
}

export interface AmortizationRow {
  paymentNumber: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number; // remaining balance after this payment
}

export function loanAmount(t: LoanTerms): number {
  return t.purchasePrice * (1 - t.downPaymentPct);
}

/** Fixed monthly principal + interest payment. */
export function monthlyPayment(t: LoanTerms): number {
  const p = loanAmount(t);
  const r = t.annualRate / 12;
  const n = t.termYears * 12;
  if (r === 0) return p / n;
  return (p * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
}

/** Full amortization schedule, one row per monthly payment. */
export function amortizationSchedule(t: LoanTerms): AmortizationRow[] {
  const r = t.annualRate / 12;
  const n = t.termYears * 12;
  const pmt = monthlyPayment(t);
  let balance = loanAmount(t);
  const rows: AmortizationRow[] = [];
  for (let i = 1; i <= n; i++) {
    const interest = balance * r;
    let principal = pmt - interest;
    if (principal > balance) principal = balance; // final payment guard
    balance = Math.max(0, balance - principal);
    rows.push({
      paymentNumber: i,
      payment: pmt,
      principal,
      interest,
      balance,
    });
  }
  return rows;
}

/** Annual straight-line depreciation on the building portion of the basis. */
export function annualDepreciation(
  purchasePrice: number,
  buildingValuePct: number,
): number {
  return (purchasePrice * buildingValuePct) / DEPRECIATION_YEARS;
}

// ---- Period metrics -------------------------------------------------------

export interface LedgerEntry {
  kind: "income" | "expense";
  amount: number; // positive
  countsTowardCost: boolean;
  isCapital: boolean;
  taxDeductible: boolean;
}

export interface PropertyInputs {
  purchasePrice: number;
  buildingValuePct: number;
  downPaymentPct: number;
  annualRate: number;
  termYears: number;
  points: number;
  closingCosts: number;
}

export interface PeriodMetrics {
  grossIncome: number;
  operatingExpenses: number; // counts-toward-cost, non-capital expenses
  capitalExpenses: number;
  excludedTotal: number; // amount tracked but NOT counted toward cost
  netOperatingIncome: number; // grossIncome - operatingExpenses
  annualDebtService: number; // 12 monthly payments
  mortgageInterest: number; // interest portion over the period
  mortgagePrincipal: number; // principal portion over the period
  cashFlow: number; // NOI - annual debt service
  depreciation: number;
  taxableIncome: number; // NOI - interest - depreciation
  capRate: number; // NOI / purchase price
  cashInvested: number; // down payment + points + closing costs
  cashOnCashReturn: number; // cashFlow / cashInvested
}

/**
 * Compute the headline metrics for a set of ledger entries covering `months`
 * of a year, plus the mortgage interest/principal split for that window.
 *
 * @param entries         ledger rows for the period
 * @param property        property + loan inputs
 * @param months          months represented (for annualizing debt service)
 * @param scheduleWindow  the amortization rows that fall in this period
 */
export function computeMetrics(
  entries: LedgerEntry[],
  property: PropertyInputs,
  months: number,
  scheduleWindow: AmortizationRow[],
): PeriodMetrics {
  let grossIncome = 0;
  let operatingExpenses = 0;
  let capitalExpenses = 0;
  let excludedTotal = 0;

  for (const e of entries) {
    if (!e.countsTowardCost) {
      excludedTotal += e.amount;
      continue; // tracked, but excluded from real cost/profit
    }
    if (e.kind === "income") {
      grossIncome += e.amount;
    } else if (e.isCapital) {
      capitalExpenses += e.amount;
    } else {
      operatingExpenses += e.amount;
    }
  }

  const netOperatingIncome = grossIncome - operatingExpenses;

  const mortgageInterest = scheduleWindow.reduce((s, r) => s + r.interest, 0);
  const mortgagePrincipal = scheduleWindow.reduce((s, r) => s + r.principal, 0);
  const annualDebtService = mortgageInterest + mortgagePrincipal;

  // Cash flow subtracts capital additions too (matches the AOPD sheet):
  // NOI − debt service − capital. Capital does not affect NOI or cap rate.
  const cashFlow = netOperatingIncome - annualDebtService - capitalExpenses;

  const depreciation =
    (annualDepreciation(property.purchasePrice, property.buildingValuePct) *
      months) /
    12;
  const taxableIncome = netOperatingIncome - mortgageInterest - depreciation;

  const capRate =
    property.purchasePrice > 0 ? netOperatingIncome / property.purchasePrice : 0;

  const cashInvested =
    property.purchasePrice * property.downPaymentPct +
    property.points +
    property.closingCosts;
  const cashOnCashReturn = cashInvested > 0 ? cashFlow / cashInvested : 0;

  return {
    grossIncome,
    operatingExpenses,
    capitalExpenses,
    excludedTotal,
    netOperatingIncome,
    annualDebtService,
    mortgageInterest,
    mortgagePrincipal,
    cashFlow,
    depreciation,
    taxableIncome,
    capRate,
    cashInvested,
    cashOnCashReturn,
  };
}

// ---- Discounted-return metrics (NPV / IRR / MIRR) -------------------------
//
// All take a `flows` array indexed by period t = 0, 1, 2, …, where flows[0] is
// the time-zero cash flow (typically the negative initial investment) and the
// final element usually bundles the terminal value (e.g. net sale proceeds).

/** Net present value at `rate`, discounting flows[t] by (1+rate)^t (t starts at 0). */
export function npv(rate: number, flows: number[]): number {
  return flows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t), 0);
}

/**
 * Internal rate of return: the `rate` where npv(rate, flows) === 0.
 * Robust bracket + bisection (no dependence on a good initial guess).
 * Returns null if there's no sign change (no computable IRR).
 */
export function irr(flows: number[]): number | null {
  const hasPos = flows.some((f) => f > 0);
  const hasNeg = flows.some((f) => f < 0);
  if (!hasPos || !hasNeg) return null;

  const f = (r: number) => npv(r, flows);
  let lo = -0.9999; // rate can't be <= -100%
  let hi = 1.0; // 100% to start; expand if needed
  let flo = f(lo);
  let fhi = f(hi);
  // expand the upper bound until we bracket a root (cap the search)
  let expand = 0;
  while (flo * fhi > 0 && hi < 1e6 && expand < 200) {
    hi *= 2;
    fhi = f(hi);
    expand++;
  }
  if (flo * fhi > 0) return null; // couldn't bracket

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-7) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Modified IRR. Negative flows are financed at `financeRate`; positive flows are
 * reinvested at `reinvestRate` (Excel's MIRR convention). n = number of periods
 * (intervals) = flows.length - 1.
 */
export function mirr(
  flows: number[],
  financeRate: number,
  reinvestRate: number,
): number | null {
  const n = flows.length - 1;
  if (n <= 0) return null;
  let pvNeg = 0; // present value of outflows (at t=0)
  let fvPos = 0; // future value of inflows (at t=n)
  for (let t = 0; t < flows.length; t++) {
    const cf = flows[t];
    if (cf < 0) pvNeg += cf / Math.pow(1 + financeRate, t);
    else if (cf > 0) fvPos += cf * Math.pow(1 + reinvestRate, n - t);
  }
  if (pvNeg === 0 || fvPos === 0) return null;
  return Math.pow(-fvPos / pvNeg, 1 / n) - 1;
}
