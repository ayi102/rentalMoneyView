"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function YearSelector({
  years,
  current,
}: {
  years: number[];
  current: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [adding, setAdding] = useState(false);
  // Always show the year being viewed, even if it has no saved data yet.
  const displayYears = years.includes(current)
    ? years
    : [...years, current].sort((a, b) => b - a);
  const maxYear = Math.max(...displayYears);
  const [draft, setDraft] = useState(String(maxYear + 1));

  function go(year: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(year));
    router.push(`${pathname}?${next.toString()}`);
  }

  function submitNew() {
    const y = parseInt(draft, 10);
    if (Number.isFinite(y) && y > 1900 && y < 3000) {
      setAdding(false);
      go(y);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
        {displayYears.map((y) => (
          <button
            key={y}
            onClick={() => go(y)}
            className={`px-3 py-1.5 text-sm transition ${
              y === current
                ? "bg-accent text-white"
                : "text-muted hover:bg-background hover:text-foreground"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {adding ? (
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-1.5 py-1">
          <input
            type="number"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNew();
              if (e.key === "Escape") setAdding(false);
            }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums outline-none focus:border-accent"
          />
          <button
            onClick={submitNew}
            className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-white"
          >
            Go
          </button>
          <button
            onClick={() => setAdding(false)}
            className="px-1.5 text-muted hover:text-foreground"
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(String(maxYear + 1));
            setAdding(true);
          }}
          title="Add / open another year"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted hover:text-foreground"
        >
          + Year
        </button>
      )}
    </div>
  );
}
