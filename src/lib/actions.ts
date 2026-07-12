"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface WorksheetInput {
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  amount: number;
  note: string;
}

/**
 * Save an entire year's worksheet. Rewrites the year's COUNTED transactions from
 * the grid (one per non-zero row); excluded items (countsTowardCost=false) are
 * left untouched. Amounts are booked at a representative mid-year date.
 */
export async function saveWorksheet(
  propertyId: string,
  year: number,
  rows: WorksheetInput[],
) {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
  });
  if (!property) throw new Error("Property not found");

  // Mid-year date, but never before the month after purchase.
  let date = new Date(Date.UTC(year, 6, 1));
  if (property.purchaseDate && property.purchaseDate.getTime() > date.getTime()) {
    date = new Date(
      Date.UTC(
        property.purchaseDate.getUTCFullYear(),
        property.purchaseDate.getUTCMonth() + 1,
        1,
      ),
    );
  }

  await prisma.$transaction([
    // remove existing counted rows for this year (keep excluded ones)
    prisma.transaction.deleteMany({
      where: {
        propertyId,
        countsTowardCost: true,
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    }),
    ...rows
      .filter((r) => Number.isFinite(r.amount) && Math.abs(r.amount) > 0)
      .map((r) =>
        prisma.transaction.create({
          data: {
            propertyId,
            date,
            kind: r.kind === "income" ? "income" : "expense",
            category: r.category,
            subcategory: r.subcategory || null,
            amount: Math.abs(r.amount),
            description: r.note?.trim() || null,
            countsTowardCost: true,
            taxDeductible: r.kind === "expense",
            isCapital: false,
          },
        }),
      ),
  ]);

  revalidatePath("/");
  revalidatePath("/summary");
  revalidatePath("/worksheet");
  revalidatePath("/ledger");
}

function parseFlags(fd: FormData) {
  return {
    countsTowardCost: fd.get("countsTowardCost") === "on",
    taxDeductible: fd.get("taxDeductible") === "on",
    isCapital: fd.get("isCapital") === "on",
  };
}

function baseFields(fd: FormData) {
  const kind = String(fd.get("kind") || "expense");
  const category = String(fd.get("category") || "").trim();
  const subRaw = String(fd.get("subcategory") || "").trim();
  const amount = Math.abs(Number(fd.get("amount")));
  const dateStr = String(fd.get("date") || "");
  const description = String(fd.get("description") || "").trim();
  return {
    kind: kind === "income" ? "income" : "expense",
    category,
    subcategory: subRaw || null,
    amount: Number.isFinite(amount) ? amount : 0,
    date: dateStr ? new Date(dateStr) : new Date(),
    description: description || null,
  };
}

export async function createTransaction(fd: FormData) {
  const propertyId = String(fd.get("propertyId") || "");
  if (!propertyId) throw new Error("Missing propertyId");
  const base = baseFields(fd);
  if (!base.category || base.amount <= 0) return; // ignore incomplete rows
  await prisma.transaction.create({
    data: { propertyId, ...base, ...parseFlags(fd) },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

export async function updateTransaction(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) throw new Error("Missing id");
  const base = baseFields(fd);
  await prisma.transaction.update({
    where: { id },
    data: { ...base, ...parseFlags(fd) },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

/** Flip a single boolean flag inline from the ledger. */
export async function toggleTransactionFlag(
  id: string,
  flag: "countsTowardCost" | "taxDeductible" | "isCapital",
) {
  const t = await prisma.transaction.findUnique({ where: { id } });
  if (!t) return;
  await prisma.transaction.update({
    where: { id },
    data: { [flag]: !t[flag] },
  });
  revalidatePath("/");
  revalidatePath("/ledger");
}

export async function deleteTransaction(id: string) {
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/");
  revalidatePath("/ledger");
}

export interface AssumptionsInput {
  currentValue: number | null; // dollars; null => estimate from appreciation
  appreciationPct: number; // percent, e.g. 3 for 3%
  discountPct: number;
  sellingCostPct: number;
  reinvestPct: number;
}

/** Update the projection assumptions on a property. Rates arrive as percents. */
export async function updateAssumptions(
  propertyId: string,
  a: AssumptionsInput,
) {
  const pct = (v: number) => (Number.isFinite(v) ? v / 100 : 0);
  await prisma.property.update({
    where: { id: propertyId },
    data: {
      currentValue:
        a.currentValue != null && Number.isFinite(a.currentValue) && a.currentValue > 0
          ? a.currentValue
          : null,
      appreciationRate: pct(a.appreciationPct),
      discountRate: pct(a.discountPct),
      sellingCostRate: pct(a.sellingCostPct),
      reinvestRate: pct(a.reinvestPct),
    },
  });
  revalidatePath("/projection");
  revalidatePath("/summary");
}
