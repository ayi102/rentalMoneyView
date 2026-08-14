/**
 * Write a timestamped backup of the whole database and prune old ones.
 *
 * Supabase's free plan has NO automated backups — their own docs tell free-tier
 * projects to export and keep off-site copies. This is that.
 *
 *   npm run db:backup
 *
 * Destination, in order of preference:
 *   1. $BACKUP_DIR
 *   2. <parent of $RENTAL_XLSX_DIR>/rentalMoneyView-backups   (usually inside a
 *      synced Google Drive folder, which makes the copy genuinely off-site)
 *   3. ./data/backups                                          (local, git-ignored)
 *
 * Backups contain your real figures. Keep them somewhere you'd be comfortable
 * keeping the spreadsheets.
 *
 * Restore with:  npx tsx scripts/load-data.ts <file> --force
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { countsOf, describe, dumpAll } from "./lib/dump";

const prisma = new PrismaClient();

/** How many backups to keep. Older ones are deleted after a successful write. */
const KEEP = Number(process.env.BACKUP_KEEP ?? 30);

const PREFIX = "rentalmoneyview-";

function resolveDir(): { dir: string; why: string } {
  if (process.env.BACKUP_DIR) {
    return { dir: process.env.BACKUP_DIR, why: "$BACKUP_DIR" };
  }
  const xlsx = process.env.RENTAL_XLSX_DIR;
  if (xlsx) {
    // Sibling of the spreadsheet folder, so backups land in the same synced place
    // the sheets already live.
    const parent = path.dirname(xlsx.replace(/\/+$/, ""));
    return {
      dir: path.join(parent, "rentalMoneyView-backups"),
      why: "alongside $RENTAL_XLSX_DIR",
    };
  }
  return { dir: path.resolve("data/backups"), why: "local fallback" };
}

/** Filesystem-safe, sorts chronologically: 2026-08-14T131826Z */
function stamp(): string {
  return new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[:]/g, "")
    .replace(/-/g, "-");
}

async function main() {
  const { dir, why } = resolveDir();
  fs.mkdirSync(dir, { recursive: true });

  const dump = await dumpAll(prisma);
  const counts = countsOf(dump);

  if (counts.properties === 0 && counts.transactions === 0) {
    // Never let an empty read overwrite a good backup history.
    console.error(
      "Database returned no properties and no transactions. Refusing to write an " +
        "empty backup — check DATABASE_URL.",
    );
    process.exit(1);
  }

  const file = path.join(dir, `${PREFIX}${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2), { mode: 0o600 });

  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`Backed up to ${file}  (${kb} KB, ${why})`);
  console.log(describe(counts));

  // Prune only after the new backup is safely on disk.
  const existing = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(".json"))
    .sort(); // timestamp names sort chronologically

  const excess = existing.slice(0, Math.max(0, existing.length - KEEP));
  for (const f of excess) {
    fs.unlinkSync(path.join(dir, f));
  }
  console.log(
    `\n${existing.length - excess.length} backup(s) kept${
      excess.length ? `, ${excess.length} pruned (BACKUP_KEEP=${KEEP})` : ""
    }.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
