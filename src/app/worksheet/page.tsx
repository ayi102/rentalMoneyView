import {
  getDefaultProperty,
  getWorksheetData,
  getYearData,
} from "@/lib/metrics";
import { currency, percent } from "@/lib/format";
import { YearSelector } from "../year-selector";
import { WorksheetForm } from "./worksheet-form";

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

export default async function WorksheetPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const property = await getDefaultProperty();
  if (!property) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold">No property yet</h1>
        <p className="mt-2 text-sm text-muted">Run the local seed to get started.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const now = new Date().getUTCFullYear();
  const year = sp.year ? Number(sp.year) : now;
  const [data, yearData] = await Promise.all([
    getWorksheetData(property, year),
    getYearData(property, year),
  ]);
  const m = yearData.metrics;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{property.name} · {year}</h1>
          <p className="text-sm text-muted">Edit each category below; totals update live.</p>
        </div>
        <YearSelector years={data.availableYears} current={year} />
      </div>

      {/* Year snapshot (as saved) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Cash Flow"
          value={currency(m.cashFlow)}
          sub="after mortgage"
          tone={m.cashFlow >= 0 ? "positive" : "negative"}
        />
        <Stat label="Cap Rate" value={percent(m.capRate)} sub="NOI / purchase price" />
        <Stat
          label="Cash-on-Cash"
          value={percent(m.cashOnCashReturn)}
          sub={`on ${currency(m.cashInvested)} invested`}
          tone={m.cashOnCashReturn >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="Taxable Income"
          value={currency(m.taxableIncome)}
          sub={`after ${currency(m.depreciation)} depreciation`}
          tone={m.taxableIncome >= 0 ? "negative" : "positive"}
        />
      </div>

      <WorksheetForm
        key={year}
        propertyId={property.id}
        year={year}
        groups={data.groups}
        excluded={data.excluded}
        constants={{
          mortgageInterest: data.mortgageInterest,
          debtService: data.debtService,
          depreciation: data.depreciation,
        }}
      />
    </div>
  );
}
