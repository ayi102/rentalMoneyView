"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface WorksheetSaveItem {
  kind: "income" | "expense";
  category: string;
  subcategory: string | null;
  amount: number;
  description: string;
  countsTowardCost: boolean;
}

/**
 * Save an entire year's worksheet. This is the single source of truth for the
 * year: it deletes ALL of that year's entries and recreates them from `items`
 * (both counted line items and excluded items). Each item is one transaction,
 * so itemizing within a category is preserved. Booked at a mid-year date.
 */
export async function saveWorksheet(
  propertyId: string,
  year: number,
  items: WorksheetSaveItem[],
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
    prisma.transaction.deleteMany({
      where: {
        propertyId,
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    }),
    ...items
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
            description: r.description?.trim() || null,
            countsTowardCost: r.countsTowardCost,
            taxDeductible: r.countsTowardCost && r.kind === "expense",
            isCapital: false,
          },
        }),
      ),
  ]);

  revalidatePath("/");
  revalidatePath("/worksheet");
  revalidatePath("/projection");
}

/** Delete every entry (and mileage) for a property in a given year. */
export async function deleteYear(propertyId: string, year: number) {
  const range = {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { propertyId, date: range } }),
    prisma.mileageEntry.deleteMany({ where: { propertyId, date: range } }),
  ]);
  revalidatePath("/");
  revalidatePath("/worksheet");
  revalidatePath("/projection");
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
  revalidatePath("/");
}
