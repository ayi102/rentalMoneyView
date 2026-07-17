"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteYear, saveWorksheet, type WorksheetSaveItem } from "@/lib/actions";
import { currency } from "@/lib/format";
import type { WorksheetGroup, WorksheetItem } from "@/lib/metrics";

interface Constants {
  mortgageInterest: number;
  debtService: number;
  depreciation: number;
}

interface Item {
  key: string;
  description: string;
  amount: string;
  tracked: boolean;
}
interface Group {
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  label: string;
  items: Item[];
}

const trackedSum = (items: Item[]) =>
  items.reduce((s, it) => s + (it.tracked ? parseFloat(it.amount) || 0 : 0), 0);
const untrackedSum = (items: Item[]) =>
  items.reduce((s, it) => s + (!it.tracked ? parseFloat(it.amount) || 0 : 0), 0);

export function WorksheetForm({
  propertyId,
  year,
  groups: initialGroups,
  capital: initialCapital,
  constants,
}: {
  propertyId: string;
  year: number;
  groups: WorksheetGroup[];
  capital: WorksheetItem[];
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
        tracked: it.tracked,
      })),
    })),
  );
  const [capital, setCapital] = useState<Item[]>(() =>
    initialCapital.map((it) => ({
      key: nextId(),
      description: it.description,
      amount: it.amount ? String(it.amount) : "",
      tracked: it.tracked,
    })),
  );
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
          ? {
              ...g,
              items: [
                ...g.items,
                { key: nextId(), description: "", amount: "", tracked: true },
              ],
            }
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
  function setFirstAmount(gi: number, v: string) {
    setGroups((gs) =>
      gs.map((g, i) =>
        i === gi
          ? { ...g, items: [{ key: nextId(), description: "", amount: v, tracked: true }] }
          : g,
      ),
    );
    touch();
  }

  // Capital additions (their own section)
  function patchCap(i: number, patch: Partial<Item>) {
    setCapital((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    touch();
  }
  function addCap() {
    setCapital((cs) => [
      ...cs,
      { key: nextId(), description: "", amount: "", tracked: true },
    ]);
    touch();
  }
  function removeCap(i: number) {
    setCapital((cs) => cs.filter((_, j) => j !== i));
    touch();
  }

  const totals = useMemo(() => {
    const sec = (kind: "income" | "expense") => {
      let counted = 0;
      let uncounted = 0;
      for (const g of groups) {
        if (g.kind !== kind) continue;
        counted += trackedSum(g.items);
        uncounted += untrackedSum(g.items);
      }
      return { counted, uncounted, total: counted + uncounted };
    };
    const income = sec("income");
    const expense = sec("expense");
    const capitalTotal = trackedSum(capital);
    const noi = income.counted - expense.counted;
    return {
      income,
      expense,
      capital: capitalTotal,
      untracked:
        income.uncounted + expense.uncounted + untrackedSum(capital),
      noi,
      cashFlow: noi - constants.debtService - capitalTotal,
      taxable: noi - constants.mortgageInterest - constants.depreciation,
    };
  }, [groups, capital, constants]);

  async function doDelete() {
    setPending(true);
    try {
      await deleteYear(propertyId, year);
      router.push("/worksheet");
      router.refresh();
    } finally {
      setPending(false);
      setConfirmingDelete(false);
    }
  }

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
            countsTowardCost: it.tracked,
          });
        }
      }
      for (const c of capital) {
        const amt = parseFloat(c.amount) || 0;
        if (amt === 0) continue;
        items.push({
          kind: "expense",
          category: "Capital Additions",
          subcategory: null,
          amount: amt,
          description: c.description,
          countsTowardCost: c.tracked,
          isCapital: true,
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {renderSection("Income", incomeGroups, totals.income)}
        {renderSection("Expenses", expenseGroups, totals.expense)}
      </div>

      {/* Capital additions (appliances, improvements) — reduce cash flow, not NOI */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Capital additions
            <span className="ml-2 font-normal text-muted">
              (appliances, improvements — reduce cash flow, not NOI)
            </span>
          </h2>
          <span className="text-sm font-semibold tabular-nums">
            {currency(totals.capital, { cents: true })}
          </span>
        </div>
        <div className="space-y-1 px-4 py-2">
          {capital.length === 0 && (
            <p className="text-sm text-muted">None this year.</p>
          )}
          {capital.map((c, i) => (
            <ItemRow
              key={c.key}
              item={c}
              onAmount={(v) => patchCap(i, { amount: v })}
              onDesc={(v) => patchCap(i, { description: v })}
              onToggle={() => patchCap(i, { tracked: !c.tracked })}
              onRemove={() => removeCap(i)}
              canRemove
            />
          ))}
          <button
            onClick={addCap}
            className="mt-1 text-xs text-accent hover:underline"
          >
            + add capital item
          </button>
        </div>
      </div>

      {/* Live computed totals */}
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4">
        <Stat label="Net Operating Income" value={totals.noi} />
        <Stat
          label="Cash Flow"
          value={totals.cashFlow}
          hint="after mortgage & capital"
          sign
        />
        <Stat label="Taxable Income" value={totals.taxable} sign />
        <Stat
          label="Not tracked"
          value={totals.untracked}
          hint="excluded from totals"
        />
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
          One line = a single value; “+ itemize” to break it out. Untick the dot to keep
          a line but leave it out of totals.
        </span>
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-negative">
              Delete all {groups.reduce((n, g) => n + g.items.length, 0)} lines for{" "}
              {year}?
            </span>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="rounded-md border border-border px-2.5 py-1 text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={doDelete}
              disabled={pending}
              className="rounded-md bg-negative px-2.5 py-1 font-medium text-white disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={pending}
            className="text-sm text-negative hover:underline disabled:opacity-50"
          >
            Delete {year}
          </button>
        )}
      </div>
    </div>
  );

  // Render one leaf group's editable rows (amount + note + track toggle + itemize).
  function renderLeaf(g: Group, i: number, asSub: boolean) {
    const subtotal = trackedSum(g.items);
    const label = asSub
      ? g.subcategory ?? g.category
      : g.subcategory
        ? `${g.category} › ${g.subcategory}`
        : g.category;
    return (
      <div
        key={`${g.category}-${g.subcategory}`}
        className={asSub ? "border-l-2 border-border pl-3" : ""}
      >
        <div className="flex items-center justify-between">
          <span className={`text-sm ${asSub ? "text-foreground" : "font-medium"}`}>
            {label}
          </span>
          {g.items.length > 1 && (
            <span className="text-xs text-muted tabular-nums">
              {currency(subtotal, { cents: true })}
            </span>
          )}
        </div>
        <div className="mt-1 space-y-1">
          {g.items.length > 0 ? (
            g.items.map((it, ii) => (
              <ItemRow
                key={it.key}
                item={it}
                onAmount={(v) => patchItem(i, ii, { amount: v })}
                onDesc={(v) => patchItem(i, ii, { description: v })}
                onToggle={() => patchItem(i, ii, { tracked: !it.tracked })}
                onRemove={() => removeItem(i, ii)}
                canRemove={g.items.length > 1}
              />
            ))
          ) : (
            <ItemRow
              item={{ key: "empty", description: "", amount: "", tracked: true }}
              onAmount={(v) => setFirstAmount(i, v)}
              onDesc={() => {}}
              onToggle={() => {}}
              onRemove={() => {}}
              canRemove={false}
            />
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
  }

  function renderSection(
    title: string,
    entries: { g: Group; i: number }[],
    tot: { counted: number; uncounted: number; total: number },
  ) {
    // Group leaves by their parent category, preserving order.
    const order: string[] = [];
    const byCat = new Map<string, { g: Group; i: number }[]>();
    for (const e of entries) {
      if (!byCat.has(e.g.category)) {
        byCat.set(e.g.category, []);
        order.push(e.g.category);
      }
      byCat.get(e.g.category)!.push(e);
    }

    return (
      <div className="rounded-xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{title}</h2>
            <span className="text-sm font-semibold tabular-nums">
              {currency(tot.counted, { cents: true })}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Total {currency(tot.total)} · Counted {currency(tot.counted)} · Uncounted{" "}
            {currency(tot.uncounted)}
          </p>
        </div>
        <div className="divide-y divide-border">
          {order.map((cat) => {
            const members = byCat.get(cat)!;
            // Only categories with 2+ types get the parent-header + indented layout.
            if (members.length <= 1) {
              return (
                <div key={cat} className="px-4 py-2">
                  {renderLeaf(members[0].g, members[0].i, false)}
                </div>
              );
            }
            // category with subtypes: header + indented subcategories
            const parentTotal = members.reduce(
              (s, m) => s + trackedSum(m.g.items),
              0,
            );
            return (
              <div key={cat} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{cat}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {currency(parentTotal, { cents: true })}
                  </span>
                </div>
                <div className="mt-1.5 space-y-2 pl-1">
                  {members.map((m) => renderLeaf(m.g, m.i, true))}
                </div>
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
  onToggle,
  onRemove,
  canRemove,
}: {
  item: Item;
  onAmount: (v: string) => void;
  onDesc: (v: string) => void;
  onToggle: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const dim = item.tracked ? "" : "opacity-50";
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onToggle}
        title={item.tracked ? "Tracked — counts toward totals" : "Not tracked — recorded but excluded"}
        aria-label={item.tracked ? "Tracked" : "Not tracked"}
        className={`h-4 w-4 shrink-0 rounded-full border transition ${
          item.tracked
            ? "border-accent bg-accent"
            : "border-border bg-transparent"
        }`}
      />
      <div className={`flex items-center gap-1 ${dim}`}>
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
        placeholder={item.tracked ? "note (optional)" : "why not tracked"}
        className={`min-w-[8rem] flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-muted outline-none focus:border-border focus:bg-background ${dim}`}
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
