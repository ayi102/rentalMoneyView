/**
 * Dump every row from the local database to a single JSON file, so the data can
 * be loaded into a different database (e.g. hosted Postgres) by
 * `scripts/load-data.ts`.
 *
 * Run this BEFORE switching prisma/schema.prisma to the postgresql provider,
 * while the client is still generated against SQLite.
 *
 * Usage:
 *   npx tsx scripts/export-local-data.ts            # -> data/local-dump.json
 *   npx tsx scripts/export-local-data.ts out.json
 *
 * The output contains your real financial figures. It's written under data/,
 * which is git-ignored — keep it that way.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const OUT = process.argv[2] ?? "data/local-dump.json";

async function main() {
  const [properties, transactions, mileage, categories] = await Promise.all([
    prisma.property.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({ orderBy: { date: "asc" } }),
    prisma.mileageEntry.findMany({ orderBy: { date: "asc" } }),
    prisma.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const dump = {
    // Bumped if the shape below ever changes, so load-data.ts can refuse a
    // dump it doesn't understand.
    formatVersion: 1,
    properties,
    transactions,
    mileage,
    categories,
  };

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Dates serialize to ISO strings via JSON.stringify; load-data.ts parses them back.
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));

  console.log(`Wrote ${outPath}`);
  console.log(
    `  properties   ${properties.length}\n` +
      `  transactions ${transactions.length}\n` +
      `  mileage      ${mileage.length}\n` +
      `  categories   ${categories.length}`,
  );

  const years = [
    ...new Set(transactions.map((t) => t.date.getUTCFullYear())),
  ].sort();
  console.log(`  years        ${years.join(", ") || "(none)"}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
