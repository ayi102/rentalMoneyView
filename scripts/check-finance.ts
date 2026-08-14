// Sanity-check the finance engine against the known 2025 AOPD spreadsheet values.
// Run: npx tsx scripts/check-finance.ts
import {
  amortizationSchedule,
  annualDepreciation,
  computeMetrics,
  irr,
  mileageDeduction,
  mileageRateFor,
  mirr,
  monthlyPayment,
  npv,
  type LedgerEntry,
} from "../src/lib/finance";

const terms = {
  purchasePrice: 377000,
  downPaymentPct: 0.2,
  annualRate: 0.04875,
  termYears: 30,
};

let pass = 0;
let fail = 0;
function check(label: string, actual: number, expected: number, tol = 1) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "✅" : "❌"} ${label.padEnd(34)} got ${actual.toFixed(2).padStart(12)}  expected ~${expected.toFixed(2)}`,
  );
}

// 1. Monthly payment
check("Monthly payment", monthlyPayment(terms), 1596.09, 0.1);

// 2. Depreciation
check("Annual depreciation", annualDepreciation(377000, 0.86), 11789.82, 1);

// 3. Amortization: 2025 was roughly payments #29–40 in the sheet.
const sched = amortizationSchedule(terms);
const window2025 = sched.slice(28, 40); // payment #29..40
const interest = window2025.reduce((s, r) => s + r.interest, 0);
const principal = window2025.reduce((s, r) => s + r.principal, 0);
check("Interest (pmts 29-40)", interest, 14055.13, 60);
check("Principal (pmts 29-40)", principal, 5097.98, 60);

// 4. Period metrics — feed the 2025 income/expense totals as counted entries.
const entries: LedgerEntry[] = [
  { kind: "income", amount: 24737, countsTowardCost: true, isCapital: false, taxDeductible: false },
  { kind: "expense", amount: 7332.42, countsTowardCost: true, isCapital: false, taxDeductible: true },
];
const m = computeMetrics(
  entries,
  { ...terms, buildingValuePct: 0.86, points: 171.91, closingCosts: 9682.15 },
  12,
  window2025,
);
check("Net Operating Income", m.netOperatingIncome, 17404.58, 0.1);
check("Cash flow", m.cashFlow, -1748.52, 60);
check("Taxable income", m.taxableIncome, -8440.37, 60);

// 5. NPV / IRR / MIRR against known values
// Your Projection sheet: NPV(13%, 30yr of $6000) - $50,000 initial = -5026.08
check(
  "NPV (your sheet)",
  npv(0.13, [-50000, ...Array(30).fill(6000)]),
  -5026.08,
  0.1,
);
// Simple IRR: -100 now, +110 next year -> 10%
check("IRR -100/+110", irr([-100, 110])! * 100, 10, 0.01);
// Excel IRR example: -1000, then 500,500,500 -> 23.375%
check("IRR -1000/500x3", irr([-1000, 500, 500, 500])! * 100, 23.375, 0.05);
// Excel MIRR docs example: values, finance 10%, reinvest 12% -> 12.6094%
check(
  "MIRR (Excel example)",
  mirr([-120000, 39000, 30000, 21000, 37000, 46000], 0.1, 0.12)! * 100,
  12.6094,
  0.01,
);

// 6. Mileage — IRS business standard rates, which change annually and changed
// mid-year in both 2022 and 2026. Rates per
// https://www.irs.gov/tax-professionals/standard-mileage-rates
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
check("Rate 2022-06-30 (H1)", mileageRateFor(d(2022, 6, 30)), 0.585, 0);
check("Rate 2022-07-01 (H2)", mileageRateFor(d(2022, 7, 1)), 0.625, 0);
check("Rate 2023-03-15", mileageRateFor(d(2023, 3, 15)), 0.655, 0);
check("Rate 2024-03-15", mileageRateFor(d(2024, 3, 15)), 0.67, 0);
check("Rate 2025-03-15", mileageRateFor(d(2025, 3, 15)), 0.7, 0);
check("Rate 2026-06-30 (H1)", mileageRateFor(d(2026, 6, 30)), 0.725, 0);
check("Rate 2026-07-01 (H2)", mileageRateFor(d(2026, 7, 1)), 0.76, 0);

// A trip either side of the 2022 change must use its own date's rate, not one
// rate for the whole year.
check(
  "Mileage across 2022 split",
  mileageDeduction([
    { date: d(2022, 6, 23), miles: 87 }, // × 0.585 = 50.895
    { date: d(2022, 8, 26), miles: 331 }, // × 0.625 = 206.875
  ]),
  257.77,
  0.01,
);

// Mileage must behave like depreciation: taxable income only. NOI, cap rate and
// cash flow are cash measures and the standard rate is not a cash cost.
const withMileage = computeMetrics(
  entries,
  { ...terms, buildingValuePct: 0.86, points: 171.91, closingCosts: 9682.15 },
  12,
  window2025,
  [{ date: d(2025, 5, 10), miles: 100 }], // × 0.70 = $70
);
check("Mileage: NOI unchanged", withMileage.netOperatingIncome, m.netOperatingIncome, 0);
check("Mileage: cash flow unchanged", withMileage.cashFlow, m.cashFlow, 0);
check("Mileage: cap rate unchanged", withMileage.capRate, m.capRate, 0);
check("Mileage: taxable -$70", withMileage.taxableIncome, m.taxableIncome - 70, 0.01);
check("Mileage: deduction reported", withMileage.mileageDeduction, 70, 0.01);
check("Mileage: miles reported", withMileage.mileageMiles, 100, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
