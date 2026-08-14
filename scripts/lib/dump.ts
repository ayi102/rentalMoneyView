// Shared dump shape, used by export-local-data.ts, backup.ts, and load-data.ts.
//
// Kept in one place deliberately: load-data.ts validates formatVersion, so two
// scripts writing subtly different shapes would produce dumps that fail to load
// only when you actually need them.
import type { PrismaClient } from "@prisma/client";

export const FORMAT_VERSION = 1;

export interface Dump {
  formatVersion: number;
  exportedAt: string;
  properties: unknown[];
  transactions: unknown[];
  mileage: unknown[];
  categories: unknown[];
}

export interface DumpCounts {
  properties: number;
  transactions: number;
  mileage: number;
  categories: number;
}

export async function dumpAll(prisma: PrismaClient): Promise<Dump> {
  const [properties, transactions, mileage, categories] = await Promise.all([
    prisma.property.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({ orderBy: { date: "asc" } }),
    prisma.mileageEntry.findMany({ orderBy: { date: "asc" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    properties,
    transactions,
    mileage,
    categories,
  };
}

export function countsOf(dump: Dump): DumpCounts {
  return {
    properties: dump.properties.length,
    transactions: dump.transactions.length,
    mileage: dump.mileage.length,
    categories: dump.categories.length,
  };
}

export function describe(counts: DumpCounts): string {
  return (
    `  properties   ${counts.properties}\n` +
    `  transactions ${counts.transactions}\n` +
    `  mileage      ${counts.mileage}\n` +
    `  categories   ${counts.categories}`
  );
}
