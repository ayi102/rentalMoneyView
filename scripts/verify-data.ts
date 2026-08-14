/**
 * Print the per-year figures the app computes, straight from whatever database
 * DATABASE_URL points at.
 *
 * Two uses:
 *  - After a migration, confirm the numbers still match what they were before.
 *  - As the reference column when cross-checking against the AOPD spreadsheets.
 *
 * Run: npm run verify:data
 */
import { getDefaultProperty, getPortfolioSummary } from "../src/lib/metrics";
import { prisma } from "../src/lib/prisma";

const money = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function pad(s: string, w: number, right = true): string {
  return right ? s.padStart(w) : s.padEnd(w);
}

async function main() {
  const property = await getDefaultProperty();
  if (!property) {
    console.error("No property found in the database.");
    process.exit(1);
  }

  const s = await getPortfolioSummary(property);

  console.log(`\n${property.name}`);
  console.log(
    `purchase ${money(property.purchasePrice)}` +
      (property.purchaseDate
        ? ` on ${property.purchaseDate.toISOString().slice(0, 10)}`
        : "") +
      `\n`,
  );

  const cols = [
    ["Year", 6],
    ["Income", 12],
    ["OpEx", 12],
    ["Capital", 11],
    ["NOI", 12],
    ["Interest", 12],
    ["Principal", 11],
    ["Cash Flow", 12],
    ["Miles", 8],
    ["Mileage$", 10],
  ] as const;

  console.log(cols.map(([h, w]) => pad(h, w)).join(""));
  console.log(cols.map(([, w]) => "-".repeat(w - 1).padStart(w)).join(""));

  for (const y of s.years) {
    if (!y.hasData) {
      console.log(pad(String(y.year), 6) + pad("(no entries)", 12));
      continue;
    }
    console.log(
      pad(String(y.year), 6) +
        pad(money(y.income), 12) +
        pad(money(y.operatingExpenses), 12) +
        pad(money(y.capitalExpenses), 11) +
        pad(money(y.noi), 12) +
        pad(money(y.interest), 12) +
        pad(money(y.principal), 11) +
        pad(money(y.cashFlow ?? 0), 12) +
        pad(y.mileageMiles ? String(y.mileageMiles) : "—", 8) +
        pad(y.mileageDeduction ? money(y.mileageDeduction) : "—", 10),
    );
  }

  console.log(cols.map(([, w]) => "-".repeat(w - 1).padStart(w)).join(""));
  console.log(
    pad(`${s.recordedYearCount}yr`, 6) +
      pad(money(s.totalIncome), 12) +
      pad(money(s.totalOperatingExpenses), 12) +
      pad(money(s.totalCapital), 11) +
      pad(money(s.totalNoi), 12) +
      pad(money(s.totalInterest), 12) +
      pad(money(s.principalPaid), 11) +
      pad(money(s.totalCashFlow), 12) +
      pad(String(s.years.reduce((n, y) => n + y.mileageMiles, 0)), 8) +
      pad(
        money(s.years.reduce((n, y) => n + y.mileageDeduction, 0)),
        10,
      ),
  );

  console.log(`\nLoan`);
  console.log(`  original          ${money(s.originalLoan)}`);
  console.log(`  balance today     ${money(s.currentBalance)}`);
  console.log(
    `  principal paid    ${money(s.principalPaid)}  (${(s.pctPaid * 100).toFixed(1)}%)`,
  );
  console.log(`  monthly payment   ${money(s.monthlyPayment)}`);

  console.log(`\nPosition`);
  console.log(`  cash earned       ${money(s.totalCashFlow)}`);
  console.log(`  buy-in costs      ${money(s.purchaseCosts)}`);
  console.log(`  cash profit       ${money(s.cashProfit)}`);
  console.log(`  equity at cost    ${money(s.equityAtCost)}`);
  console.log(`  net position      ${money(s.netPosition)}`);
  console.log(`  not tracked       ${money(s.totalExcluded)}`);
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
