/**
 * Load a dump produced by `scripts/export-local-data.ts` into whatever database
 * DATABASE_URL currently points at (e.g. hosted Postgres).
 *
 * Row ids from the dump are preserved, so Transaction/MileageEntry -> Property
 * relations survive the move.
 *
 * Usage:
 *   npx tsx scripts/load-data.ts                      # data/local-dump.json
 *   npx tsx scripts/load-data.ts path/to/dump.json
 *   npx tsx scripts/load-data.ts --force              # replace existing rows
 *
 * Safety: if the target database already holds properties or transactions, this
 * refuses to run unless you pass --force. --force DELETES the target's existing
 * properties, transactions, mileage, and categories before loading — it does not
 * merge. Your source dump is only ever read.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { FORMAT_VERSION } from "./lib/dump";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const force = args.includes("--force");
// Validate a dump without writing anything. An unverified backup is only a hope,
// so this makes "is this file actually restorable?" answerable at any time.
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--")) ?? "data/local-dump.json";

const SUPPORTED_FORMAT = FORMAT_VERSION;

interface Dump {
  formatVersion: number;
  /** Added alongside backups; older dumps won't have it. */
  exportedAt?: string;
  properties: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
  mileage: Record<string, unknown>[];
  categories: Record<string, unknown>[];
}

/** JSON.stringify turned Dates into ISO strings; turn the known ones back. */
function revive<T extends Record<string, unknown>>(
  row: T,
  dateFields: string[],
): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of dateFields) {
    if (out[f] != null) out[f] = new Date(out[f] as string);
  }
  return out as T;
}

/**
 * Check a dump could be restored, without connecting to any database: every row
 * revives, dates parse, foreign keys resolve, and nothing is empty.
 */
function validateOnly(dump: Dump, dumpPath: string): void {
  const problems: string[] = [];

  const properties = dump.properties.map((p) =>
    revive(p, ["purchaseDate", "createdAt", "updatedAt"]),
  );
  const transactions = dump.transactions.map((t) =>
    revive(t, ["date", "createdAt", "updatedAt"]),
  );
  const mileage = dump.mileage.map((m) => revive(m, ["date", "createdAt"]));

  // Any date that failed to parse becomes Invalid Date, which would insert as null
  // or throw — either way it's corruption worth catching here.
  const badDates = (rows: Record<string, unknown>[], fields: string[]) =>
    rows.filter((r) =>
      fields.some((f) => {
        const v = r[f];
        return v instanceof Date && Number.isNaN(v.getTime());
      }),
    ).length;

  const bad =
    badDates(properties, ["purchaseDate", "createdAt", "updatedAt"]) +
    badDates(transactions, ["date", "createdAt", "updatedAt"]) +
    badDates(mileage, ["date", "createdAt"]);
  if (bad > 0) problems.push(`${bad} row(s) contain an unparseable date`);

  // Transactions and mileage reference a property by id; a dump missing its
  // parent property would fail on insert.
  const propertyIds = new Set(properties.map((p) => p.id as string));
  const orphans = [...transactions, ...mileage].filter(
    (r) => !propertyIds.has(r.propertyId as string),
  ).length;
  if (orphans > 0) {
    problems.push(`${orphans} transaction/mileage row(s) reference a missing property`);
  }

  if (properties.length === 0) problems.push("no properties in the dump");
  if (transactions.length === 0) problems.push("no transactions in the dump");

  const years = [
    ...new Set(
      transactions
        .map((t) => t.date as Date)
        .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()))
        .map((d) => d.getUTCFullYear()),
    ),
  ].sort();

  console.log(`Dry run — nothing was written.\n`);
  console.log(`  file          ${dumpPath}`);
  if (dump.exportedAt) console.log(`  exported      ${dump.exportedAt}`);
  console.log(`  formatVersion ${dump.formatVersion}`);
  console.log(`  properties    ${properties.length}`);
  console.log(`  transactions  ${transactions.length}`);
  console.log(`  mileage       ${mileage.length}`);
  console.log(`  categories    ${dump.categories.length}`);
  console.log(`  years         ${years.join(", ") || "(none)"}`);

  if (problems.length) {
    console.error(`\nThis dump would NOT restore cleanly:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`\nThis dump is restorable. To actually restore it:`);
  console.log(`  npx tsx scripts/load-data.ts "${dumpPath}" --force`);
}

async function main() {
  const dumpPath = path.resolve(file);
  if (!fs.existsSync(dumpPath)) {
    console.error(
      `No dump at ${dumpPath}\nRun \`npm run db:export\` against the source database first.`,
    );
    process.exit(1);
  }

  const dump: Dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
  if (dump.formatVersion !== SUPPORTED_FORMAT) {
    console.error(
      `Dump formatVersion ${dump.formatVersion}, this script understands ${SUPPORTED_FORMAT}.`,
    );
    process.exit(1);
  }

  if (dryRun) {
    validateOnly(dump, dumpPath);
    return;
  }

  const [existingProps, existingTxns, existingCats] = await Promise.all([
    prisma.property.count(),
    prisma.transaction.count(),
    // Categories matter here too: the dump carries its own, and Category has a
    // unique constraint on (kind, name, parent). Loading on top of a seeded
    // taxonomy would otherwise die on a constraint violation partway through
    // rather than saying what's wrong. In particular, don't run `db:seed` before
    // this — the dump already includes the taxonomy.
    prisma.category.count(),
  ]);
  const notEmpty = existingProps > 0 || existingTxns > 0 || existingCats > 0;

  if (notEmpty && !force) {
    console.error(
      `Target database is not empty (${existingProps} properties, ${existingTxns} transactions, ${existingCats} categories).\n` +
        `Refusing to load. Re-run with --force to DELETE those rows and replace them.\n` +
        `Note: the dump includes the category taxonomy, so there's no need to run \`db:seed\` first.`,
    );
    process.exit(1);
  }

  if (force && notEmpty) {
    console.log(
      `--force: deleting ${existingProps} properties, ${existingTxns} transactions and ${existingCats} categories from the target…`,
    );
    // Transactions and mileage cascade from Property, but delete explicitly so the
    // counts we print are honest.
    await prisma.$transaction([
      prisma.transaction.deleteMany({}),
      prisma.mileageEntry.deleteMany({}),
      prisma.property.deleteMany({}),
      prisma.category.deleteMany({}),
    ]);
  }

  const properties = dump.properties.map((p) =>
    revive(p, ["purchaseDate", "createdAt", "updatedAt"]),
  );
  const transactions = dump.transactions.map((t) =>
    revive(t, ["date", "createdAt", "updatedAt"]),
  );
  const mileage = dump.mileage.map((m) => revive(m, ["date", "createdAt"]));
  const categories = dump.categories;

  // Properties first — transactions and mileage reference them.
  await prisma.$transaction([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.property.createMany({ data: properties as any }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.category.createMany({ data: categories as any }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.transaction.createMany({ data: transactions as any }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.mileageEntry.createMany({ data: mileage as any }),
  ]);

  const after = {
    properties: await prisma.property.count(),
    transactions: await prisma.transaction.count(),
    mileage: await prisma.mileageEntry.count(),
    categories: await prisma.category.count(),
  };
  console.log(`Loaded from ${dumpPath}:`);
  console.log(
    `  properties   ${after.properties} (dump had ${properties.length})\n` +
      `  transactions ${after.transactions} (dump had ${transactions.length})\n` +
      `  mileage      ${after.mileage} (dump had ${mileage.length})\n` +
      `  categories   ${after.categories} (dump had ${categories.length})`,
  );

  const mismatch =
    after.properties !== properties.length ||
    after.transactions !== transactions.length ||
    after.mileage !== mileage.length ||
    after.categories !== categories.length;
  if (mismatch) {
    console.error("\nRow counts do not match the dump. Investigate before using this data.");
    process.exit(1);
  }
  console.log("\nAll row counts match the dump.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
