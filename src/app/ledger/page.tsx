import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  getCategories,
  getDefaultProperty,
  getTransactionsForYear,
  getAvailableYears,
} from "@/lib/metrics";
import { currency } from "@/lib/format";
import { YearSelector } from "../year-selector";
import { TransactionForm } from "./transaction-form";
import { LedgerTable, type Row } from "./ledger-table";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; show?: string; edit?: string }>;
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
  const availableYears = await getAvailableYears(property.id);
  const year = sp.year ? Number(sp.year) : availableYears[0];
  const show = sp.show === "all" ? "all" : "counted";

  const categories = await getCategories();
  const all = await getTransactionsForYear(property.id, year);
  const visible = show === "all" ? all : all.filter((t) => t.countsTowardCost);

  const editing = sp.edit
    ? await prisma.transaction.findUnique({ where: { id: sp.edit } })
    : null;

  const rows: Row[] = visible.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    kind: t.kind,
    category: t.category,
    subcategory: t.subcategory,
    amount: t.amount,
    description: t.description,
    countsTowardCost: t.countsTowardCost,
    taxDeductible: t.taxDeductible,
    isCapital: t.isCapital,
  }));

  const excludedCount = all.filter((t) => !t.countsTowardCost).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ledger</h1>
          <p className="text-sm text-muted">{property.name}</p>
        </div>
        <YearSelector years={availableYears} current={year} />
      </div>

      <TransactionForm
        propertyId={property.id}
        categories={categories}
        editing={
          editing
            ? {
                id: editing.id,
                date: editing.date,
                kind: editing.kind,
                category: editing.category,
                subcategory: editing.subcategory,
                amount: editing.amount,
                description: editing.description,
                countsTowardCost: editing.countsTowardCost,
                taxDeductible: editing.taxDeductible,
                isCapital: editing.isCapital,
              }
            : undefined
        }
      />

      {/* View filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface text-sm">
          <Link
            href={`/ledger?year=${year}&show=counted`}
            className={`px-3 py-1.5 ${
              show === "counted"
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            Counts toward cost
          </Link>
          <Link
            href={`/ledger?year=${year}&show=all`}
            className={`px-3 py-1.5 ${
              show === "all"
                ? "bg-accent text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            Everything ({all.length})
          </Link>
        </div>
        {excludedCount > 0 && show === "counted" && (
          <p className="text-xs text-muted">
            {excludedCount} excluded {excludedCount === 1 ? "entry" : "entries"} hidden —
            switch to “Everything” to see them.
          </p>
        )}
        <p className="text-sm text-muted">
          Showing {rows.length} of {all.length} · net{" "}
          <span className="font-medium tabular-nums text-foreground">
            {currency(
              visible.reduce(
                (s, t) => s + (t.kind === "income" ? t.amount : -t.amount),
                0,
              ),
              { cents: true },
            )}
          </span>
        </p>
      </div>

      <LedgerTable rows={rows} />
    </div>
  );
}
