import { getDefaultProperty, getProjection } from "@/lib/metrics";
import { currency, percent } from "@/lib/format";
import { AssumptionsForm } from "./assumptions-form";
import { ValueOverTimeChart } from "./projection-charts";

export const dynamic = "force-dynamic";

function Stat({
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

const pctOrDash = (v: number | null) => (v == null ? "—" : percent(v));

export default async function ProjectionPage() {
  const property = await getDefaultProperty();
  if (!property) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">No property yet</h1>
        <p className="mt-2 text-sm text-muted">Run the local seed to get started.</p>
      </div>
    );
  }

  const p = await getProjection(property);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Projection & returns</h1>
        <p className="text-sm text-muted">
          {property.name} · return if sold today, and value over time. Everything
          recomputes from your live data.
        </p>
      </div>

      {/* Return metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="NPV"
          value={currency(p.npv)}
          sub={`@ ${percent(p.discountRate)} discount`}
          tone={p.npv >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="IRR"
          value={pctOrDash(p.irr)}
          sub="annualized return"
          tone={p.irr != null && p.irr >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="MIRR"
          value={pctOrDash(p.mirr)}
          sub={`reinvest @ ${percent(p.reinvestRate)}`}
          tone={p.mirr != null && p.mirr >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Equity if sold today"
          value={currency(p.terminalEquity)}
          sub={`after ${percent(p.sellingCostRate)} selling costs`}
          tone="positive"
        />
        <Stat
          label="Total profit if sold"
          value={currency(p.totalProfitIfSold)}
          sub="equity + cash flow − invested"
          tone={p.totalProfitIfSold >= 0 ? "positive" : "negative"}
        />
      </div>

      <AssumptionsForm
        propertyId={property.id}
        currentValue={p.currentValue}
        isEstimatedValue={p.isEstimatedValue}
        estimatedValue={p.currentValue}
        appreciationPct={+(p.appreciationRate * 100).toFixed(2)}
        discountPct={+(p.discountRate * 100).toFixed(2)}
        sellingCostPct={+(p.sellingCostRate * 100).toFixed(2)}
        reinvestPct={+(p.reinvestRate * 100).toFixed(2)}
      />

      {/* Value over time */}
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Value, loan & equity over time</h2>
          <span className="text-xs text-muted">
            value grows at {percent(p.appreciationRate)}/yr from{" "}
            {currency(property.purchasePrice)} ({p.purchaseYear})
          </span>
        </div>
        <ValueOverTimeChart data={p.valueOverTime} />
      </section>

      {/* Cash-flow series behind the return */}
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 text-right font-medium">Cash flow</th>
              <th className="px-4 py-2.5 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="px-4 py-2 font-medium">{p.purchaseYear} · purchase</td>
              <td className="px-4 py-2 text-right tabular-nums text-negative">
                −{currency(p.initialInvestment)}
              </td>
              <td className="px-4 py-2 text-muted">
                down payment + points + closing
              </td>
            </tr>
            {p.cashFlowByYear.map((y, i) => {
              const isLast = i === p.cashFlowByYear.length - 1;
              return (
                <tr key={y.year} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{y.year}</td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      y.cashFlow >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {currency(y.cashFlow)}
                    {isLast && (
                      <span className="text-positive">
                        {" "}
                        + {currency(p.terminalEquity)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {isLast ? "operating cash flow + sale proceeds today" : "operating cash flow"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-muted">
        IRR/MIRR/NPV treat your up-front cash ({currency(p.initialInvestment)}) as
        the investment, each year&apos;s cash flow as it came in, and selling today
        at {currency(p.currentValue)}
        {p.isEstimatedValue ? " (estimated)" : ""} as the final payoff. Adjust the
        assumptions above and everything recalculates.
      </p>
    </div>
  );
}
