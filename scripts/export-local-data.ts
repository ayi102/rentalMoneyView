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
import { countsOf, describe, dumpAll } from "./lib/dump";

const prisma = new PrismaClient();

const OUT = process.argv[2] ?? "data/local-dump.json";

async function main() {
  const dump = await dumpAll(prisma);

  const outPath = path.resolve(OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Dates serialize to ISO strings via JSON.stringify; load-data.ts parses them back.
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), { mode: 0o600 });

  console.log(`Wrote ${outPath}`);
  console.log(describe(countsOf(dump)));

  const years = [
    ...new Set(
      (dump.transactions as { date: Date }[]).map((t) =>
        t.date.getUTCFullYear(),
      ),
    ),
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
