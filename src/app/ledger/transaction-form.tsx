"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createTransaction, updateTransaction } from "@/lib/actions";
import { dateInputValue } from "@/lib/format";

export interface CategoryOption {
  kind: string;
  name: string;
  parent: string | null;
}

export interface EditingTransaction {
  id: string;
  date: Date;
  kind: string;
  category: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  countsTowardCost: boolean;
  taxDeductible: boolean;
  isCapital: boolean;
}

export function TransactionForm({
  propertyId,
  categories,
  editing,
}: {
  propertyId: string;
  categories: CategoryOption[];
  editing?: EditingTransaction;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<string>(editing?.kind ?? "expense");
  const [category, setCategory] = useState<string>(editing?.category ?? "");
  const [pending, setPending] = useState(false);

  const topLevel = useMemo(
    () => categories.filter((c) => c.kind === kind && c.parent === null),
    [categories, kind],
  );
  const subcategories = useMemo(
    () => categories.filter((c) => c.kind === kind && c.parent === category),
    [categories, kind, category],
  );

  async function onSubmit(formData: FormData) {
    setPending(true);
    try {
      if (editing) await updateTransaction(formData);
      else await createTransaction(formData);
      if (editing) {
        router.push("/ledger");
      } else {
        // reset the form for the next entry
        (document.getElementById("txn-form") as HTMLFormElement)?.reset();
        setCategory("");
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const label = "block text-xs font-medium text-muted mb-1";
  const input =
    "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <form
      id="txn-form"
      action={onSubmit}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <input type="hidden" name="propertyId" value={propertyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}

      <div className="grid gap-3 md:grid-cols-6">
        <div className="md:col-span-1">
          <label className={label}>Type</label>
          <select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCategory("");
            }}
            className={input}
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>

        <div className="md:col-span-1">
          <label className={label}>Category</label>
          <select
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={input}
            required
          >
            <option value="" disabled>
              Select…
            </option>
            {topLevel.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1">
          <label className={label}>Subcategory</label>
          <select
            name="subcategory"
            defaultValue={editing?.subcategory ?? ""}
            className={input}
            disabled={subcategories.length === 0}
          >
            <option value="">—</option>
            {subcategories.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-1">
          <label className={label}>Amount</label>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={editing?.amount ?? ""}
            className={input}
            placeholder="0.00"
            required
          />
        </div>

        <div className="md:col-span-1">
          <label className={label}>Date</label>
          <input
            name="date"
            type="date"
            defaultValue={dateInputValue(editing?.date ?? new Date())}
            className={input}
            required
          />
        </div>

        <div className="md:col-span-1">
          <label className={label}>Description</label>
          <input
            name="description"
            type="text"
            defaultValue={editing?.description ?? ""}
            className={input}
            placeholder="optional"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Flag
          name="countsTowardCost"
          defaultChecked={editing ? editing.countsTowardCost : true}
          label="Counts toward cost"
          hint="uncheck to track but exclude"
        />
        <Flag
          name="taxDeductible"
          defaultChecked={editing ? editing.taxDeductible : kind === "expense"}
          label="Tax deductible"
        />
        <Flag
          name="isCapital"
          defaultChecked={editing ? editing.isCapital : false}
          label="Capital expense"
          hint="vs. operating"
        />

        <div className="ml-auto flex gap-2">
          {editing && (
            <button
              type="button"
              onClick={() => router.push("/ledger")}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Add entry"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Flag({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      <span>
        {label}
        {hint && <span className="ml-1 text-xs text-muted">({hint})</span>}
      </span>
    </label>
  );
}
