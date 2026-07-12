"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { currency } from "@/lib/format";
import type { ValuePoint } from "@/lib/metrics";

const VALUE = "#1f6feb";
const BALANCE = "#e07a54";
const EQUITY = "#2f9e73";
const axisStyle = { fontSize: 12, fill: "var(--muted)" };

export function ValueOverTimeChart({ data }: { data: ValuePoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        Add loan details to project value over time.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
        <defs>
          <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EQUITY} stopOpacity={0.25} />
            <stop offset="100%" stopColor={EQUITY} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v, name) => [
            currency(Number(v)),
            name === "value" ? "Est. value" : name === "balance" ? "Loan balance" : "Equity",
          ]}
          labelFormatter={(l) => `Year ${l}`}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
          }}
        />
        <Legend
          formatter={(v) =>
            v === "value" ? "Est. market value" : v === "balance" ? "Loan balance" : "Equity"
          }
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke={EQUITY}
          strokeWidth={2}
          fill="url(#equityFill)"
        />
        <Line type="monotone" dataKey="value" stroke={VALUE} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="balance" stroke={BALANCE} strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
