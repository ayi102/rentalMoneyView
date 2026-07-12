import { getDefaultProperty, getWorksheetData } from "@/lib/metrics";
import { YearSelector } from "../year-selector";
import { WorksheetForm } from "./worksheet-form";

export const dynamic = "force-dynamic";

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
  const data = await getWorksheetData(property, year);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Worksheet</h1>
          <p className="text-sm text-muted">
            {property.name} · edit each category for {year}
          </p>
        </div>
        <YearSelector years={data.availableYears} current={year} />
      </div>

      <WorksheetForm
        key={year}
        propertyId={property.id}
        year={year}
        rows={data.rows}
        constants={{
          mortgageInterest: data.mortgageInterest,
          debtService: data.debtService,
          depreciation: data.depreciation,
        }}
      />
    </div>
  );
}
