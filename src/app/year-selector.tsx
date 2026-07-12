"use client";

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

  function go(year: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(year));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border bg-surface">
      {years.map((y) => (
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
  );
}
