"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveWorksheet, type WorksheetSaveItem } from "@/lib/actions";
import { currency } from "@/lib/format";
import type { WorksheetExcluded, WorksheetGroup } from "@/lib/metrics";

interface Constants {
  mortgageInterest: number;
  debtService: number;
  depreciation: number;
}

interface Item {
  key: string;
  description: string;
  amount: string;
}
interface Group {
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  label: string;
  items: Item[];
}
interface Excl {
  key: string;
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  description: string;
  amount: string;
}

const sum = (items: Item[]) =>
  items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);

export function WorksheetForm({
  propertyId,
  year,
  groups: initialGroups,
  excluded: initialExcluded,
  constants,
}: {
  propertyId: string;
  year: number;
  groups: WorksheetGroup[];
  excluded: WorksheetExcluded[];
  constants: Constants;
}) {
  const router = useRouter();
  const idRef = useRef(0);
  const nextId = () => `k${idRef.current++}`;

  const [groups, setGroups] = useState<Group[]>(() =>
    initialGroups.map((g) => ({
      ...g,
      items: g.items.map((it) => ({
        key: nextId(),
        description: it.description,
        amount: it.amount ? String(it.amount) : "",
      })),
    })),
  );
  const [excluded, setExcluded] = useState<Excl[]>(() =>
    initialExcluded.map((e) => ({
      key: nextId(),
      kind: e.kind,
      category: e.category,
      subcategory: e.subcategory,
      description: e.description,
      amount: e.amount ? String(e.amount) : "",
    })),
  );
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  const touch = () => {
    setDirty(true);
    setSaved(false);
  };

  function patchItem(gi: number, ii: number, patch: Partial<Item>) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i === gi
          ? { ...g, items: g.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }
          : g,
      ),
    );
    touch();
  }
  function addItem(gi: number) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i === gi
          ? { ...g, items: [...g.items, { key: nextId(), description: "", amount: "" }] }
          : g,
      ),
    );
    touch();
  }
  function removeItem(gi: number, ii: number) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i === gi ? { ...g, items: g.items.filter((_, j) => j !== ii) } : g,
      ),
    );
    touch();
  }

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const g of groups) {
      if (g.kind === "income") income += sum(g.items);
      else expense += sum(g.items);
    }
    const noi = income - expense;
    return {
      income,
      expense,
      noi,
      cashFlow: noi - constants.debtService,
      taxable: noi - constants.mortgageInterest - constants.depreciation,
      excluded: excluded.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0),
    };
  }, [groups, excluded, constants]);

  async function onSave() {
    setPending(true);
    try {
      const items: WorksheetSaveItem[] = [];
      for (const g of groups) {
        for (const it of g.items) {
          const amt = parseFloat(it.amount) || 0;
          if (amt === 0) continue;
          items.push({
            kind: g.kind,
            category: g.category,
            subcategory: g.subcategory,
            amount: amt,
            description: it.description,
            countsTowardCost: true,
          });
        }
      }
      for (const e of excluded) {
        const amt = parseFloat(e.amount) || 0;
        if (amt === 0) continue;
        items.push({
          kind: e.kind,
          category: e.category,
          subcategory: e.subcategory,
          amount: amt,
          description: e.description,
          countsTowardCost: false,
        });
      }
      await saveWorksheet(propertyId, year, items);
      setDirty(false);
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const incomeGroups = groups
    .map((g, i) => ({ g, i }))
    .filter((x) => x.g.kind === "income");
  const expenseGroups = groups
    .map((g, i) => ({ g, i }))
    .filter((x) => x.g.kind === "expense");

  const groupOptions = groups.map((g) => ({ label: g.label, g }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {renderSection("Income", incomeGroups, totals.income)}
        {renderSection("Expenses", expenseGroups, totals.expense)}
      </div>

      {/* Live computed totals */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4">
        <Stat label="Net Operating Income" value={totals.noi} />
        <Stat label="Cash Flow" value={totals.cashFlow} hint="after mortgage" sign />
        <Stat label="Taxable Income" value={totals.taxable} sign />
        <Stat label="Mortgage (yr)" value={-constants.debtService} hint="P&I paid" />
      </div>

      {/* Excluded / tracked-but-not-counted */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Tracked but not counted
            <span className="ml-2 font-normal text-muted">
              (kept for your records, excluded from totals)
            </span>
          </h2>
          <span className="text-sm text-muted tabular-nums">
            {currency(totals.excluded, { cents: true })}
          </span>
        </div>
        <div className="divide-y divide-border">
          {excluded.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">Nothing excluded.</p>
          )}
          {excluded.map((e, i) => (
            <div key={e.key} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <select
                value={`${e.kind}|${e.category}|${e.subcategory ?? ""}`}
                onChange={(ev) => {
                  const opt = groupOptions.find(
                    (o) =>
                      `${o.g.kind}|${o.g.category}|${o.g.subcategory ?? ""}` ===
                      ev.target.value,
                  );
                  if (opt)
                    setExcluded((xs) =>
                      xs.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              kind: opt.g.kind,
                              category: opt.g.category,
                              subcategory: opt.g.subcategory,
                            }
                          : x,
                      ),
                    );
                  touch();
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
              >
                {groupOptions.map((o) => (
                  <option
                    key={o.label}
                    value={`${o.g.kind}|${o.g.category}|${o.g.subcategory ?? ""}`}
                  >
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={e.description}
                onChange={(ev) => {
                  setExcluded((xs) =>
                    xs.map((x, j) => (j === i ? { ...x, description: ev.target.value } : x)),
                  );
                  touch();
                }}
                placeholder="note (e.g. tax prep — done ourselves)"
                className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
              />
              <div className="flex items-center gap-1">
                <span className="text-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={e.amount}
                  onChange={(ev) => {
                    setExcluded((xs) =>
                      xs.map((x, j) => (j === i ? { ...x, amount: ev.target.value } : x)),
                    );
                    touch();
                  }}
                  placeholder="0"
                  className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={() => {
                  setExcluded((xs) => xs.filter((_, j) => j !== i));
                  touch();
                }}
                className="text-muted hover:text-negative"
                aria-label="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-2">
          <button
            onClick={() => {
              const first = groups[0];
              setExcluded((xs) => [
                ...xs,
                {
                  key: nextId(),
                  kind: first?.kind ?? "expense",
                  category: first?.category ?? "Miscellaneous",
                  subcategory: first?.subcategory ?? null,
                  description: "",
                  amount: "",
                },
              ]);
              touch();
            }}
            className="text-sm text-accent hover:underline"
          >
            + Add excluded item
          </button>
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur">
        <button
          onClick={onSave}
          disabled={pending || !dirty}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save ${year}`}
        </button>
        {dirty && !pending && <span className="text-sm text-muted">Unsaved changes</span>}
        {saved && !dirty && <span className="text-sm text-positive">Saved ✓</span>}
        <span className="ml-auto text-xs text-muted">
          One line per category = a single value; add lines to itemize. Totals update live.
        </span>
      </div>
    </div>
  );

  function renderSection(
    title: string,
    entries: { g: Group; i: number }[],
    total: number,
  ) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-sm font-semibold tabular-nums">
            {currency(total, { cents: true })}
          </span>
        </div>
        <div className="divide-y divide-border">
          {entries.map(({ g, i }) => {
            const subtotal = sum(g.items);
            const rows = g.items.length ? g.items : [null];
            return (
              <div key={`${g.category}-${g.subcategory}`} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {g.subcategory ? (
                      <>
                        <span className="text-muted">{g.category} › </span>
                        {g.subcategory}
                      </>
                    ) : (
                      g.category
                    )}
                  </span>
                  {g.items.length > 1 && (
                    <span className="text-xs text-muted tabular-nums">
                      {currency(subtotal, { cents: true })}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {rows.map((it, ii) =>
                    it === null ? (
                      <ItemRow
                        key="empty"
                        item={{ key: "empty", description: "", amount: "" }}
                        onAmount={(v) => {
                          // typing into the empty row creates the first item
                          setGroups((gs) =>
                            gs.map((gg, gj) =>
                              gj === i
                                ? {
                                    ...gg,
                                    items: [{ key: nextId(), description: "", amount: v }],
                                  }
                                : gg,
                            ),
                          );
                          touch();
                        }}
                        onDesc={() => {}}
                        onRemove={() => {}}
                        canRemove={false}
                      />
                    ) : (
                      <ItemRow
                        key={it.key}
                        item={it}
                        onAmount={(v) => patchItem(i, ii, { amount: v })}
                        onDesc={(v) => patchItem(i, ii, { description: v })}
                        onRemove={() => removeItem(i, ii)}
                        canRemove={g.items.length > 1}
                      />
                    ),
                  )}
                </div>
                <button
                  onClick={() => addItem(i)}
                  className="mt-1 text-xs text-accent hover:underline"
                >
                  + itemize
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

function ItemRow({
  item,
  onAmount,
  onDesc,
  onRemove,
  canRemove,
}: {
  item: Item;
  onAmount: (v: string) => void;
  onDesc: (v: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <span className="text-muted">$</span>
        <input
          type="number"
          step="0.01"
          value={item.amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder="0"
          className="w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-accent"
        />
      </div>
      <input
        type="text"
        value={item.description}
        onChange={(e) => onDesc(e.target.value)}
        placeholder="note (optional)"
        className="min-w-[8rem] flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-muted outline-none focus:border-border focus:bg-background"
      />
      {canRemove && (
        <button
          onClick={onRemove}
          className="text-muted hover:text-negative"
          aria-label="Remove line"
        >
          ✕
        </button>
      )}
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>
        {currency(value)}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
