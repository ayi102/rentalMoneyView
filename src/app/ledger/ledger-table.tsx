"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTransaction, toggleTransactionFlag } from "@/lib/actions";
import { currency, shortDate } from "@/lib/format";

export interface Row {
  id: string;
  date: string; // ISO
  kind: string;
  category: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  countsTowardCost: boolean;
  taxDeductible: boolean;
  isCapital: boolean;
}

export function LedgerTable({ rows }: { rows: Row[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(id: string, flag: "countsTowardCost" | "taxDeductible" | "isCapital") {
    startTransition(async () => {
      await toggleTransactionFlag(id, flag);
      router.refresh();
    });
  }

  function remove(id: string, label: string) {
    if (!confirm(`Delete this ${label} entry? This can't be undone.`)) return;
    startTransition(async () => {
      await deleteTransaction(id);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
        No entries for this filter. Add one above.
      </p>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-xl border border-border bg-surface ${pending ? "opacity-70" : ""}`}>
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Category</th>
            <th className="px-4 py-2.5 text-right font-medium">Amount</th>
            <th className="px-4 py-2.5 text-center font-medium">Flags</th>
            <th className="px-4 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isIncome = r.kind === "income";
            return (
              <tr
                key={r.id}
                className={`border-b border-border last:border-0 ${
                  r.countsTowardCost ? "" : "bg-background/60"
                }`}
              >
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                  {shortDate(new Date(r.date))}
                </td>
                <td className="px-4 py-2.5">
                  <span className="font-medium">{r.category}</span>
                  {r.subcategory && (
                    <span className="text-muted"> › {r.subcategory}</span>
                  )}
                  {r.description && (
                    <span className="block text-xs text-muted">{r.description}</span>
                  )}
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-2.5 text-right font-medium tabular-nums ${
                    isIncome ? "text-positive" : "text-foreground"
                  }`}
                >
                  {isIncome ? "+" : "−"}
                  {currency(r.amount, { cents: true })}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-center gap-1.5">
                    <Chip
                      active={r.countsTowardCost}
                      onClick={() => toggle(r.id, "countsTowardCost")}
                      title="Counts toward real cost"
                    >
                      Counts
                    </Chip>
                    <Chip
                      active={r.taxDeductible}
                      onClick={() => toggle(r.id, "taxDeductible")}
                      title="Tax deductible"
                    >
                      Tax
                    </Chip>
                    <Chip
                      active={r.isCapital}
                      onClick={() => toggle(r.id, "isCapital")}
                      title="Capital expense"
                    >
                      Capital
                    </Chip>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <Link
                    href={`/ledger?edit=${r.id}`}
                    className="mr-3 text-accent hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => remove(r.id, r.kind)}
                    className="text-negative hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-full border px-2 py-0.5 text-xs transition ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
