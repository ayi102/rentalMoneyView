// Sanity-check the finance engine against the known 2025 AOPD spreadsheet values.
// Run: npx tsx scripts/check-finance.ts
import {
  amortizationSchedule,
  annualDepreciation,
  computeMetrics,
  irr,
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
  (ok ? pass++ : fail++, void 0);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
