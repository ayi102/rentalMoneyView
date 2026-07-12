"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { currency } from "@/lib/format";

const PRINCIPAL = "#2f9e73";
const BALANCE = "#1f6feb";
const axisStyle = { fontSize: 12, fill: "var(--muted)" };

export interface LoanChartPoint {
  year: number;
  principal: number;
  balance: number;
}

export function LoanPaydownChart({ data }: { data: LoanChartPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        No loan on file for this property.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="left"
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v, name) => [
            currency(Number(v)),
            name === "principal" ? "Principal paid" : "Loan balance",
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
            v === "principal" ? "Principal paid (year)" : "Loan balance (year-end)"
          }
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar
          yAxisId="left"
          dataKey="principal"
          fill={PRINCIPAL}
          radius={[3, 3, 0, 0]}
          barSize={28}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="balance"
          stroke={BALANCE}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
