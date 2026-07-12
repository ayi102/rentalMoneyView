import { getDefaultProperty, getPortfolioSummary } from "@/lib/metrics";
import { currency, percent } from "@/lib/format";
import { LoanPaydownChart } from "./summary-charts";

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

export default async function SummaryPage() {
  const property = await getDefaultProperty();
  if (!property) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">No property yet</h1>
        <p className="mt-2 text-sm text-muted">Run the local seed to get started.</p>
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
        <h1 className="text-xl font-semibold">All-years overview</h1>
        <p className="text-sm text-muted">
          {property.name} · where you stand across every year
        </p>
      </div>

      {/* Headline: overall position */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Cash Flow"
          value={currency(s.totalCashFlow)}
          sub={`${s.recordedYearCount} recorded ${
            s.recordedYearCount === 1 ? "year" : "years"
          } · after mortgage`}
          tone={s.totalCashFlow >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Principal Paid"
          value={currency(s.principalPaid)}
          sub={`equity built · ${percent(s.pctPaid)} of loan`}
          tone="positive"
        />
        <StatCard
          label="Net Position"
          value={currency(s.netPosition)}
          sub="cash flow + principal (equity)"
          tone={s.netPosition >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Loan Balance"
          value={currency(s.currentBalance)}
          sub={`from ${currency(s.originalLoan)} original`}
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

      {/* Per-year table */}
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
                className={`border-b border-border last:border-0 ${
                  y.hasData ? "" : "text-muted"
                }`}
              >
                <td className="px-4 py-2.5 font-medium">
                  {y.year}
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
        Cash-flow totals cover years with recorded transactions
        {s.recordedYearCount > 0 ? "" : " (none yet)"}. Principal paid and loan
        balance are computed from the amortization schedule through today, so they
        stay accurate even for years you haven&apos;t entered yet. Import earlier
        years to fill in the blanks.
      </p>
    </div>
  );
}
