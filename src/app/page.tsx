import Link from "next/link";
import { getDefaultProperty, getPortfolioSummary } from "@/lib/metrics";
import { currency, percent } from "@/lib/format";
import { LoanPaydownChart } from "./all-years-chart";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function num(v: number | null, opts?: { cents?: boolean }) {
  return v === null ? <span className="text-muted">—</span> : currency(v, opts);
}

export default async function HomeAllYears() {
  const property = await getDefaultProperty();
  if (!property) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">No property yet</h1>
        <p className="mt-2 text-sm text-muted">
          Run the local seed, or enter figures in the{" "}
          <Link href="/worksheet" className="text-accent underline">
            worksheet
          </Link>
          .
        </p>
      </div>
    );
  }

  const s = await getPortfolioSummary(property);
  const chartData = s.years.map((y) => ({
    year: y.year,
    principal: y.principal,
    balance: y.endingBalance,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{property.name}</h1>
        <p className="text-sm text-muted">
          All-years overview · where you stand across every year
        </p>
      </div>

      {/* Net position, built only from known quantities (no home value) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Cash Earned"
          value={currency(s.totalCashFlow)}
          sub={`rental cash flow · ${s.recordedYearCount} ${
            s.recordedYearCount === 1 ? "year" : "years"
          }`}
          tone={s.totalCashFlow >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Principal Paid"
          value={`+${currency(s.principalPaid)}`}
          sub={`equity built · ${percent(s.pctPaid)} of loan`}
          tone="positive"
        />
        <StatCard
          label="Buy-in Cost"
          value={currency(-s.purchaseCosts)}
          sub="points + closing (down pmt excluded)"
          tone="negative"
        />
        <StatCard
          label="Net Position"
          value={currency(s.netPosition)}
          sub="cash + principal − buy-in"
          tone={s.netPosition >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Loan paydown progress */}
      {s.hasLoan && (
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <h2 className="font-semibold">Loan paydown</h2>
            <span className="text-muted">
              {currency(s.principalPaid)} of {currency(s.originalLoan)} paid ·{" "}
              {percent(s.pctPaid)}
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-background">
            <div
              className="h-full rounded-full bg-positive"
              style={{ width: `${Math.min(100, Math.max(0, s.pctPaid * 100))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {currency(s.monthlyPayment)}/mo · balance {currency(s.currentBalance)}{" "}
            remaining
          </p>
        </section>
      )}

      {/* Chart */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">
          Principal paid per year & loan balance
        </h2>
        <LoanPaydownChart data={chartData} />
      </section>

      {/* Per-year table — click a year to open its worksheet */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">Year</th>
              <th className="px-4 py-2.5 text-right font-medium">Income</th>
              <th className="px-4 py-2.5 text-right font-medium">Expenses</th>
              <th className="px-4 py-2.5 text-right font-medium">Cash Flow</th>
              <th className="px-4 py-2.5 text-right font-medium">Principal Gained</th>
              <th className="px-4 py-2.5 text-right font-medium">Loan Balance</th>
            </tr>
          </thead>
          <tbody>
            {s.years.map((y) => (
              <tr
                key={y.year}
                className={`border-b border-border last:border-0 hover:bg-background ${
                  y.hasData ? "" : "text-muted"
                }`}
              >
                <td className="px-4 py-2.5 font-medium">
                  <Link href={`/worksheet?year=${y.year}`} className="text-accent hover:underline">
                    {y.year}
                  </Link>
                  {!y.hasData && (
                    <span className="ml-2 text-xs font-normal text-muted">
                      no data
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {y.hasData ? currency(y.income) : num(null)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {y.hasData ? currency(y.operatingExpenses) : num(null)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                    y.cashFlow === null
                      ? ""
                      : y.cashFlow >= 0
                        ? "text-positive"
                        : "text-negative"
                  }`}
                >
                  {num(y.cashFlow)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-positive">
                  {y.principal > 0 ? currency(y.principal) : num(null)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {s.hasLoan ? currency(y.endingBalance) : num(null)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {currency(s.totalIncome)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {currency(s.totalOperatingExpenses)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${
                  s.totalCashFlow >= 0 ? "text-positive" : "text-negative"
                }`}
              >
                {currency(s.totalCashFlow)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-positive">
                {currency(s.principalPaid)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {currency(s.currentBalance)}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <p className="text-xs text-muted">
        Click a year to open its worksheet. <strong>Net Position</strong> uses only
        what you know for certain — cash earned, principal paid down, and the{" "}
        {currency(s.purchaseCosts)} of buy-in costs — with <em>no</em> guess at the
        home&apos;s market value. Your {currency(s.initialInvestment - s.purchaseCosts)}{" "}
        down payment isn&apos;t subtracted: at cost it&apos;s still equity you hold,
        so it cancels out. Want to factor in today&apos;s market value (and see
        NPV/IRR/MIRR)? That&apos;s on the Projection tab.
      </p>
    </div>
  );
}
