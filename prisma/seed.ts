import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Category taxonomy mirrored from the existing AOPD spreadsheet.
// parent = null means a top-level category; otherwise it's a subcategory.
const CATEGORIES: { kind: string; name: string; parent: string | null }[] = [
  // Income
  { kind: "income", name: "Rent", parent: null },
  { kind: "income", name: "Other Income", parent: null },

  // Expense — top level
  { kind: "expense", name: "Accounting", parent: null },
  { kind: "expense", name: "Advertising", parent: null },
  { kind: "expense", name: "Education", parent: null },
  { kind: "expense", name: "HOA", parent: null },
  { kind: "expense", name: "Insurance", parent: null },
  { kind: "expense", name: "Legal", parent: null },
  { kind: "expense", name: "Lawn", parent: null },
  { kind: "expense", name: "Property Management", parent: null },
  { kind: "expense", name: "Repairs and Maintenance", parent: null },
  { kind: "expense", name: "Taxes", parent: null },
  { kind: "expense", name: "Utilities", parent: null },
  { kind: "expense", name: "Miscellaneous", parent: null },

  // Expense — subcategories
  { kind: "expense", name: "Flood", parent: "Insurance" },
  { kind: "expense", name: "Home Owners", parent: "Insurance" },
  { kind: "expense", name: "Cutting", parent: "Lawn" },
  { kind: "expense", name: "Spray", parent: "Lawn" },
  { kind: "expense", name: "Termite", parent: "Lawn" },
  { kind: "expense", name: "Property", parent: "Taxes" },
  { kind: "expense", name: "Water", parent: "Utilities" },
  { kind: "expense", name: "Electricity", parent: "Utilities" },
  { kind: "expense", name: "Gas", parent: "Utilities" },
  { kind: "expense", name: "Trash", parent: "Utilities" },
  { kind: "expense", name: "Internet", parent: "Utilities" },
];

async function main() {
  // Categories — find-or-create (upsert can't match on a null compound-unique field)
  let order = 0;
  for (const c of CATEGORIES) {
    const found = await prisma.category.findFirst({
      where: { kind: c.kind, name: c.name, parent: c.parent },
    });
    if (found) {
      await prisma.category.update({
        where: { id: found.id },
        data: { sortOrder: order },
      });
    } else {
      await prisma.category.create({ data: { ...c, sortOrder: order } });
    }
    order++;
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);
  console.log(
    "Note: property + real financial data are seeded separately by the git-ignored prisma/seed.local.ts",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
