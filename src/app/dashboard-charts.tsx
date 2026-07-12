"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CategoryTotal, MonthlyPoint } from "@/lib/metrics";
import { currency } from "@/lib/format";

const INCOME = "#2f9e73";
const EXPENSE = "#e07a54";
const CAT_COLORS = [
  "#1f6feb", "#e07a54", "#2f9e73", "#b06fd6", "#d9a441",
  "#4bb3c4", "#d15a8a", "#6b7280", "#8bbf4d", "#c0564b",
];

const axisStyle = { fontSize: 12, fill: "var(--muted)" };

function money(v: number) {
  return currency(v);
}

export function IncomeExpenseChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisStyle}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v, name) => [
            money(Number(v)),
            name === "income" ? "Income" : "Expense",
          ]}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
          }}
        />
        <Legend
          formatter={(v) => (v === "income" ? "Income" : "Expense")}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="income" fill={INCOME} radius={[3, 3, 0, 0]} />
        <Bar dataKey="expense" fill={EXPENSE} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExpenseBreakdownChart({ data }: { data: CategoryTotal[] }) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        No counted expenses yet for this year.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
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
          formatter={(v) => [money(Number(v)), "Spent"]}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--foreground)",
          }}
        />
        <Bar dataKey="amount" radius={[0, 3, 3, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
