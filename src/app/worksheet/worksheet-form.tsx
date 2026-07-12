"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveWorksheet, type WorksheetInput } from "@/lib/actions";
import { currency } from "@/lib/format";
import type { WorksheetRow } from "@/lib/metrics";

interface Constants {
  mortgageInterest: number;
  debtService: number;
  depreciation: number;
}

interface EditableRow extends WorksheetRow {
  amountStr: string;
}

export function WorksheetForm({
  propertyId,
  year,
  rows: initialRows,
  constants,
}: {
  propertyId: string;
  year: number;
  rows: WorksheetRow[];
  constants: Constants;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableRow[]>(
    initialRows.map((r) => ({
      ...r,
      amountStr: r.amount ? String(r.amount) : "",
    })),
  );
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  function update(idx: number, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(false);
  }

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      const v = parseFloat(r.amountStr) || 0;
      if (r.kind === "income") income += v;
      else expense += v;
    }
    const noi = income - expense;
    return {
      income,
      expense,
      noi,
      cashFlow: noi - constants.debtService,
      taxable: noi - constants.mortgageInterest - constants.depreciation,
    };
  }, [rows, constants]);

  async function onSave() {
    setPending(true);
    try {
      const payload: WorksheetInput[] = rows.map((r) => ({
        kind: r.kind,
        category: r.category,
        subcategory: r.subcategory,
        amount: parseFloat(r.amountStr) || 0,
        note: r.note,
      }));
      await saveWorksheet(propertyId, year, payload);
      setDirty(false);
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const income = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.kind === "income");
  const expense = rows
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.kind === "expense");

  const section = (
    title: string,
    items: { r: EditableRow; i: number }[],
    total: number,
  ) => (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-sm font-semibold tabular-nums">
          {currency(total, { cents: true })}
        </span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {items.map(({ r, i }) => (
            <tr key={`${r.category}-${r.subcategory}`} className="border-b border-border last:border-0">
              <td className="py-1.5 pl-4 pr-2 align-middle">
                {r.subcategory ? (
                  <span>
                    <span className="text-muted">{r.category} › </span>
                    {r.subcategory}
                  </span>
                ) : (
                  r.category
                )}
              </td>
              <td className="w-36 py-1.5 pr-2 align-middle">
                <div className="flex items-center gap-1">
                  <span className="text-muted">$</span>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={r.amountStr}
                    onChange={(e) => update(i, { amountStr: e.target.value })}
                    placeholder="0"
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-right tabular-nums outline-none focus:border-accent"
                  />
                </div>
              </td>
              <td className="w-1/3 py-1.5 pr-4 align-middle">
                <input
                  type="text"
                  value={r.note}
                  onChange={(e) => update(i, { note: e.target.value })}
                  placeholder="note"
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-muted outline-none focus:border-border focus:bg-background"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {section("Income", income, totals.income)}
        {section("Expenses", expense, totals.expense)}
      </div>

      {/* Live computed totals */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4">
        <Stat label="Net Operating Income" value={totals.noi} />
        <Stat
          label="Cash Flow"
          value={totals.cashFlow}
          hint="after mortgage"
          sign
        />
        <Stat label="Taxable Income" value={totals.taxable} sign />
        <Stat
          label="Mortgage (yr)"
          value={-constants.debtService}
          hint="P&I paid"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={pending || !dirty}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save ${year}`}
        </button>
        {dirty && !pending && (
          <span className="text-sm text-muted">Unsaved changes</span>
        )}
        {saved && !dirty && (
          <span className="text-sm text-positive">Saved ✓</span>
        )}
        <span className="ml-auto text-xs text-muted">
          Totals update live. Excluded items aren&apos;t shown here — manage those in
          the Ledger.
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  sign,
}: {
  label: string;
  value: number;
  hint?: string;
  sign?: boolean;
}) {
  const tone = sign
    ? value >= 0
      ? "text-positive"
      : "text-negative"
    : "text-foreground";
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>
        {currency(value)}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
