import Link from "next/link";
import { getDefaultProperty, getYearData } from "@/lib/metrics";
import { currency, percent } from "@/lib/format";
import { YearSelector } from "./year-selector";
import {
  ExpenseBreakdownChart,
  IncomeBreakdownChart,
} from "./dashboard-charts";

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

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const property = await getDefaultProperty();
  if (!property) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">No property yet</h1>
        <p className="mt-2 text-sm text-muted">
          Run the local seed, or add transactions from the{" "}
          <Link href="/ledger" className="text-accent underline">
            ledger
          </Link>
          .
        </p>
      </div>
    );
  }

  const sp = await searchParams;
  const years = (await getYearData(property, new Date().getFullYear()))
    .availableYears;
  const year = sp.year ? Number(sp.year) : years[0];
  const data = await getYearData(property, year);
  const m = data.metrics;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{property.name}</h1>
          <p className="text-sm text-muted">
            {property.squareFeet ? `${property.squareFeet} ft² · ` : ""}
            Purchased {currency(property.purchasePrice)} · Economic outlook
          </p>
        </div>
        <YearSelector years={data.availableYears} current={year} />
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Cash Flow"
          value={currency(m.cashFlow)}
          sub={`${year} · after mortgage`}
          tone={m.cashFlow >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Net Operating Income"
          value={currency(m.netOperatingIncome)}
          sub="income − operating expenses"
          tone={m.netOperatingIncome >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="Cap Rate"
          value={percent(m.capRate)}
          sub={`NOI / ${currency(property.purchasePrice)}`}
        />
        <StatCard
          label="Cash-on-Cash"
          value={percent(m.cashOnCashReturn)}
          sub={`on ${currency(m.cashInvested)} invested`}
          tone={m.cashOnCashReturn >= 0 ? "positive" : "negative"}
        />
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Gross Income" value={currency(m.grossIncome)} sub="counted" />
        <StatCard
          label="Operating Expenses"
          value={currency(m.operatingExpenses)}
          sub="counted, non-capital"
        />
        <StatCard
          label="Mortgage (P&I)"
          value={currency(data.monthlyPayment)}
          sub={`per month · ${currency(m.annualDebtService)}/yr`}
        />
        <StatCard
          label="Taxable Income"
          value={currency(m.taxableIncome)}
          sub={`after ${currency(m.depreciation)} depreciation`}
          tone={m.taxableIncome >= 0 ? "negative" : "positive"}
        />
      </div>

      {/* Breakdowns (totals by category) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Income by category</h2>
          <IncomeBreakdownChart data={data.incomeByCategory} />
        </section>
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Where the money goes</h2>
          <ExpenseBreakdownChart data={data.expenseByCategory} />
        </section>
      </div>

      {/* Excluded panel — the "truth vs. counted" view */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Tracked but not counted
            <span className="ml-2 font-normal text-muted">
              (in your records, excluded from real cost)
            </span>
          </h2>
          <span className="text-sm font-semibold tabular-nums text-muted">
            {currency(m.excludedTotal)}
          </span>
        </div>
        {data.excluded.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Nothing excluded this year — every entry counts toward your real cost.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {data.excluded.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium">{e.category}</span>
                  {e.description && (
                    <span className="text-muted"> — {e.description}</span>
                  )}
                </span>
                <span className="tabular-nums text-muted">
                  {currency(e.amount, { cents: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          If these <em>did</em> count, your cash flow would be{" "}
          {currency(m.cashFlow - m.excludedTotal)}.
        </p>
      </section>
    </div>
  );
}
