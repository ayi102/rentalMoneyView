"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteYear,
  saveWorksheet,
  type WorksheetSaveItem,
  type WorksheetSaveTrip,
} from "@/lib/actions";
import { currency } from "@/lib/format";
// finance.ts is pure (no imports at all), so the client can share the exact rate
// logic the server uses rather than hardcoding a second copy of the tax math.
import { mileageDeduction, mileageRateFor } from "@/lib/finance";
import type {
  WorksheetGroup,
  WorksheetItem,
  WorksheetTrip,
} from "@/lib/metrics";

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
interface Trip {
  key: string;
  date: string; // yyyy-mm-dd
  source: string;
  destination: string;
  reason: string;
  miles: string;
}
interface Group {
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  label: string;
  items: Item[];
}

// Stable React keys for rows. A module-level counter (rather than a ref) keeps this
// usable inside useState initializers: keys only need to be unique among siblings,
// and they never reach the DOM, so a monotonic counter is enough.
let idCounter = 0;
const nextId = () => `k${idCounter++}`;

const trackedSum = (items: Item[]) =>
  items.reduce((s, it) => s + (it.tracked ? parseFloat(it.amount) || 0 : 0), 0);
const untrackedSum = (items: Item[]) =>
  items.reduce((s, it) => s + (!it.tracked ? parseFloat(it.amount) || 0 : 0), 0);

/** How long to wait after typing stops before autosaving. */
const AUTOSAVE_DELAY_MS = 2000;

export function WorksheetForm({
  propertyId,
  year,
  version: initialVersion,
  groups: initialGroups,
  capital: initialCapital,
  trips: initialTrips,
  constants,
}: {
  propertyId: string;
  year: number;
  version: string;
  groups: WorksheetGroup[];
  capital: WorksheetItem[];
  trips: WorksheetTrip[];
  constants: Constants;
}) {
  const router = useRouter();

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
  const [trips, setTrips] = useState<Trip[]>(() =>
    initialTrips.map((t) => ({
      key: nextId(),
      date: t.date,
      source: t.source,
      destination: t.destination,
      reason: t.reason,
      miles: t.miles ? String(t.miles) : "",
    })),
  );
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [version, setVersion] = useState(initialVersion);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // How many lines the year had when it loaded. Autosave compares against this to
  // avoid quietly persisting a mass deletion — see blockedReason. Captured once at
  // mount; the page keys this component by year, so it remounts when the year
  // changes and this is recomputed.
  const [initialLineCount] = useState(
    () =>
      initialGroups.reduce((n, g) => n + g.items.length, 0) +
      initialCapital.length +
      initialTrips.length,
  );

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

  // Mileage log
  function patchTrip(i: number, patch: Partial<Trip>) {
    setTrips((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    touch();
  }
  function addTrip() {
    setTrips((ts) => [
      ...ts,
      {
        key: nextId(),
        // Default into the year being edited so a new trip is never filed under
        // the wrong one.
        date: `${year}-01-01`,
        source: "",
        destination: "",
        reason: "",
        miles: "",
      },
    ]);
    touch();
  }
  function removeTrip(i: number) {
    setTrips((ts) => ts.filter((_, j) => j !== i));
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

    // Each trip is valued at the IRS rate in force on its own date — the rate
    // changed mid-year in 2022 and 2026, so the date matters, not just the year.
    const validTrips = trips
      .map((t) => ({
        date: new Date(`${t.date}T00:00:00.000Z`),
        miles: parseFloat(t.miles) || 0,
      }))
      .filter((t) => t.miles > 0 && !Number.isNaN(t.date.getTime()));
    const miles = validTrips.reduce((s, t) => s + t.miles, 0);
    const mileage = mileageDeduction(validTrips);

    return {
      income,
      expense,
      capital: capitalTotal,
      untracked:
        income.uncounted + expense.uncounted + untrackedSum(capital),
      noi,
      miles,
      mileage,
      // Mileage at the standard rate is a tax deduction, not a cash cost, so like
      // depreciation it leaves cash flow alone and only moves taxable income.
      cashFlow: noi - constants.debtService - capitalTotal,
      taxable:
        noi - constants.mortgageInterest - constants.depreciation - mileage,
    };
  }, [groups, capital, trips, constants]);

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

  const buildPayload = useCallback(() => {
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
    const tripPayload: WorksheetSaveTrip[] = trips
      .filter((t) => (parseFloat(t.miles) || 0) > 0)
      .map((t) => ({
        date: t.date,
        source: t.source,
        destination: t.destination,
        reason: t.reason,
        miles: parseFloat(t.miles) || 0,
      }));
    return { items, tripPayload };
  }, [groups, capital, trips]);

  /**
   * Why autosave is currently held back, or null if it's free to run.
   *
   * Saving replaces the whole year, so a state that drops most of the lines would
   * genuinely delete them. That's fine as a deliberate act and alarming as a
   * side-effect of typing, so big reductions wait for an explicit Save.
   */
  const blockedReason = useMemo(() => {
    const { items, tripPayload } = buildPayload();
    const now = items.length + tripPayload.length;
    const before = initialLineCount;
    if (before === 0) return null; // nothing to lose
    if (now === 0) return "this would clear every line";
    if (now < before / 2) {
      return `this removes ${before - now} of ${before} lines`;
    }
    return null;
  }, [buildPayload, initialLineCount]);

  const save = useCallback(
    async (auto: boolean) => {
      const { items, tripPayload } = buildPayload();
      setPending(true);
      try {
        const res = await saveWorksheet(
          propertyId,
          year,
          items,
          tripPayload,
          version,
        );
        if (!res.ok) {
          // Someone else saved this year since the form loaded. Don't overwrite.
          setConflict(true);
          return;
        }
        setVersion(res.version);
        setDirty(false);
        setSaved(true);
        setSavedAt(
          new Date().toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
        // Only re-render on an explicit save — refreshing mid-typing would yank
        // the page around under the user.
        if (!auto) router.refresh();
      } finally {
        setPending(false);
      }
    },
    [buildPayload, propertyId, year, version, router],
  );

  // Autosave: fires once typing has been idle for a moment.
  useEffect(() => {
    if (!dirty || pending || conflict || blockedReason) return;
    const t = setTimeout(() => void save(true), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [dirty, pending, conflict, blockedReason, save]);

  // Flush before the page goes away. On a phone, backgrounding the app is the
  // most likely way to lose the last few seconds of edits.
  useEffect(() => {
    const flush = () => {
      if (dirty && !pending && !conflict && !blockedReason) void save(true);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [dirty, pending, conflict, blockedReason, save]);

  // Last line of defence for the cases autosave deliberately won't handle.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onSave = () => void save(false);

  const incomeGroups = groups
    .map((g, i) => ({ g, i }))
    .filter((x) => x.g.kind === "income");
  const expenseGroups = groups
    .map((g, i) => ({ g, i }))
    .filter((x) => x.g.kind === "expense");

  return (
    <div className="space-y-4">
      {/* The year changed elsewhere. Saving would replace whatever landed, so the
          only safe options are to reload or to deliberately overwrite. */}
      {conflict && (
        <div
          role="alert"
          className="rounded-xl border border-negative/40 bg-negative/10 p-4"
        >
          <p className="text-sm font-semibold text-negative">
            {year} was changed somewhere else
          </p>
          <p className="mt-1 text-sm text-muted">
            Another device or tab saved this year after you opened it. Saving now
            would replace those changes, so autosave has stopped. Your edits on
            this screen are still here.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => router.refresh()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
            >
              Reload {year} (discards edits on this screen)
            </button>
            <button
              onClick={async () => {
                // Explicit override: drop the version check for one save.
                const { items, tripPayload } = buildPayload();
                setPending(true);
                try {
                  const res = await saveWorksheet(
                    propertyId,
                    year,
                    items,
                    tripPayload,
                  );
                  if (res.ok) {
                    setVersion(res.version);
                    setConflict(false);
                    setDirty(false);
                    setSaved(true);
                    router.refresh();
                  }
                } finally {
                  setPending(false);
                }
              }}
              disabled={pending}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
            >
              Keep mine and overwrite
            </button>
          </div>
        </div>
      )}

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

      {/* Mileage log — a tax deduction, so it moves taxable income only */}
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Mileage
            <span className="ml-2 font-normal text-muted">
              (IRS standard rate — reduces taxable income, not cash flow)
            </span>
          </h2>
          <span className="text-sm font-semibold tabular-nums">
            {totals.miles.toLocaleString("en-US")} mi ·{" "}
            {currency(totals.mileage, { cents: true })}
          </span>
        </div>
        <div className="px-4 py-2">
          {trips.length === 0 ? (
            <p className="text-sm text-muted">No trips logged this year.</p>
          ) : (
            <>
              {/* Column headers, desktop only — each row is self-labelling on mobile */}
              <div className="hidden gap-2 pb-1 text-xs uppercase tracking-wide text-muted sm:flex">
                <span className="w-32">Date</span>
                <span className="flex-1">From</span>
                <span className="flex-1">To</span>
                <span className="flex-1">Reason</span>
                <span className="w-20 text-right">Miles</span>
                <span className="w-16 text-right">Rate</span>
                <span className="w-6" />
              </div>
              <div className="space-y-2 sm:space-y-1">
                {trips.map((t, i) => (
                  <TripRow
                    key={t.key}
                    trip={t}
                    year={year}
                    onPatch={(patch) => patchTrip(i, patch)}
                    onRemove={() => removeTrip(i)}
                  />
                ))}
              </div>
            </>
          )}
          <button
            onClick={addTrip}
            className="mt-2 text-xs text-accent hover:underline"
          >
            + add trip
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
        <Stat
          label="Taxable Income"
          value={totals.taxable}
          hint={
            totals.mileage > 0
              ? `incl. ${currency(totals.mileage, { cents: true })} mileage`
              : undefined
          }
          sign
        />
        <Stat
          label="Not tracked"
          value={totals.untracked}
          hint="excluded from totals"
        />
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/95 p-3 backdrop-blur">
        <button
          onClick={onSave}
          disabled={pending || !dirty}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : `Save ${year}`}
        </button>
        {pending && <span className="text-sm text-muted">Saving…</span>}
        {!pending && dirty && !blockedReason && !conflict && (
          <span className="text-sm text-muted">Unsaved changes</span>
        )}
        {!pending && !dirty && saved && (
          <span className="text-sm text-positive">
            Saved{savedAt ? ` ${savedAt}` : ""} ✓
          </span>
        )}
        {/* Autosave stood down: say so, and why, rather than looking broken. */}
        {!pending && dirty && blockedReason && !conflict && (
          <span className="text-sm text-negative">
            Not autosaved — {blockedReason}. Press Save to confirm.
          </span>
        )}
        {/* Help text is desktop-only — on a phone the toolbar needs the room. */}
        <span className="hidden text-xs text-muted sm:ml-auto sm:inline">
          One line = a single value; “+ itemize” to break it out. Untick the dot to keep
          a line but leave it out of totals.
        </span>
        {confirmingDelete ? (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm sm:ml-0">
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
            className="ml-auto text-sm text-negative hover:underline disabled:opacity-50 sm:ml-0"
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
    <div className="flex items-center gap-1">
      {/* Visible dot stays small, but the padding gives it a thumb-sized hit area. */}
      <button
        onClick={onToggle}
        title={item.tracked ? "Tracked — counts toward totals" : "Not tracked — recorded but excluded"}
        aria-label={item.tracked ? "Tracked" : "Not tracked"}
        aria-pressed={item.tracked}
        className="-m-1 shrink-0 p-2.5"
      >
        <span
          className={`block h-4 w-4 rounded-full border transition ${
            item.tracked
              ? "border-accent bg-accent"
              : "border-border bg-transparent"
          }`}
        />
      </button>
      <div className={`flex items-center gap-1 ${dim}`}>
        <span className="text-muted">$</span>
        <input
          type="number"
          step="0.01"
          // Brings up the decimal keypad on a phone instead of the full keyboard.
          inputMode="decimal"
          value={item.amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder="0"
          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-accent sm:w-28"
        />
      </div>
      {/* min-w-0 lets this shrink instead of pushing the row wider than the phone. */}
      <input
        type="text"
        value={item.description}
        onChange={(e) => onDesc(e.target.value)}
        placeholder={item.tracked ? "note (optional)" : "why not tracked"}
        className={`min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-muted outline-none focus:border-border focus:bg-background ${dim}`}
      />
      {canRemove && (
        <button
          onClick={onRemove}
          className="-m-1 shrink-0 p-2.5 text-muted hover:text-negative"
          aria-label="Remove line"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function TripRow({
  trip,
  year,
  onPatch,
  onRemove,
}: {
  trip: Trip;
  year: number;
  onPatch: (patch: Partial<Trip>) => void;
  onRemove: () => void;
}) {
  const miles = parseFloat(trip.miles) || 0;
  const parsed = new Date(`${trip.date}T00:00:00.000Z`);
  const dateValid = !Number.isNaN(parsed.getTime());
  const inYear = dateValid && parsed.getUTCFullYear() === year;
  const rate = dateValid ? mileageRateFor(parsed) : 0;

  const field =
    "rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2 sm:flex-nowrap sm:border-0 sm:pb-0">
      <input
        type="date"
        value={trip.date}
        onChange={(e) => onPatch({ date: e.target.value })}
        // Nudge toward the year being edited; the server clamps anything outside it.
        min={`${year}-01-01`}
        max={`${year}-12-31`}
        aria-label="Trip date"
        className={`w-32 ${field} ${inYear ? "" : "border-negative text-negative"}`}
      />
      <input
        type="text"
        value={trip.source}
        onChange={(e) => onPatch({ source: e.target.value })}
        placeholder="from"
        aria-label="From"
        className={`min-w-0 flex-1 basis-32 ${field}`}
      />
      <input
        type="text"
        value={trip.destination}
        onChange={(e) => onPatch({ destination: e.target.value })}
        placeholder="to"
        aria-label="To"
        className={`min-w-0 flex-1 basis-32 ${field}`}
      />
      <input
        type="text"
        value={trip.reason}
        onChange={(e) => onPatch({ reason: e.target.value })}
        // The IRS expects the business purpose recorded, so this isn't decorative.
        placeholder="reason"
        aria-label="Reason"
        className={`min-w-0 flex-1 basis-32 ${field}`}
      />
      <input
        type="number"
        step="0.1"
        inputMode="decimal"
        value={trip.miles}
        onChange={(e) => onPatch({ miles: e.target.value })}
        placeholder="0"
        aria-label="Miles"
        className={`w-20 text-right tabular-nums ${field}`}
      />
      {/* The rate in force on this trip's date, so the arithmetic is visible. */}
      <span
        className="w-16 text-right text-xs tabular-nums text-muted"
        title={
          dateValid
            ? `${miles} mi × $${rate.toFixed(3)}/mi = ${currency(Math.round(miles * rate * 100) / 100, { cents: true })}`
            : undefined
        }
      >
        {dateValid ? `${(rate * 100).toFixed(1)}¢` : "—"}
      </span>
      <button
        onClick={onRemove}
        className="-m-1 shrink-0 p-2.5 text-muted hover:text-negative"
        aria-label="Remove trip"
      >
        ✕
      </button>
      {!inYear && (
        <p className="w-full text-xs text-negative">
          Date is outside {year} — it will be saved as {year}-07-01.
        </p>
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
