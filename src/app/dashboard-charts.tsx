"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryTotal } from "@/lib/metrics";
import { currency } from "@/lib/format";

const INCOME_COLORS = ["#2f9e73", "#4bb3c4", "#8bbf4d", "#5a9bd4", "#b0c94d"];
const EXPENSE_COLORS = [
  "#e07a54", "#d15a8a", "#d9a441", "#b06fd6", "#c0564b",
  "#1f6feb", "#4bb3c4", "#6b7280", "#8bbf4d", "#2f9e73",
];

const axisStyle = { fontSize: 12, fill: "var(--muted)" };

function BreakdownChart({
  data,
  colors,
  label,
  empty,
}: {
  data: CategoryTotal[];
  colors: string[];
  label: string;
  empty: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">{empty}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
        />
        <YAxis
          type="category"
          dataKey="category"
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={150}
        />
        <Tooltip
          formatter={(v) => [currency(Number(v)), label]}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
          }}
        />
        <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function IncomeBreakdownChart({ data }: { data: CategoryTotal[] }) {
  return (
    <BreakdownChart
      data={data}
      colors={INCOME_COLORS}
      label="Received"
      empty="No income recorded for this year."
    />
  );
}

export function ExpenseBreakdownChart({ data }: { data: CategoryTotal[] }) {
  return (
    <BreakdownChart
      data={data}
      colors={EXPENSE_COLORS}
      label="Spent"
      empty="No counted expenses for this year."
    />
  );
}
