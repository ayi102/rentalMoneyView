-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "purchasePrice" DOUBLE PRECISION NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "squareFeet" DOUBLE PRECISION,
    "yearBuilt" INTEGER,
    "buildingValuePct" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "loanRate" DOUBLE PRECISION,
    "loanTermYears" INTEGER,
    "downPaymentPct" DOUBLE PRECISION,
    "points" DOUBLE PRECISION,
    "closingCosts" DOUBLE PRECISION,
    "monthlyRent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentValue" DOUBLE PRECISION,
    "appreciationRate" DOUBLE PRECISION NOT NULL DEFAULT 0.03,
    "discountRate" DOUBLE PRECISION NOT NULL DEFAULT 0.13,
    "sellingCostRate" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "reinvestRate" DOUBLE PRECISION NOT NULL DEFAULT 0.08,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "countsTowardCost" BOOLEAN NOT NULL DEFAULT true,
    "taxDeductible" BOOLEAN NOT NULL DEFAULT true,
    "isCapital" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MileageEntry" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "destination" TEXT,
    "reason" TEXT,
    "miles" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MileageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_propertyId_date_idx" ON "Transaction"("propertyId", "date");

-- CreateIndex
CREATE INDEX "Transaction_propertyId_kind_idx" ON "Transaction"("propertyId", "kind");

-- CreateIndex
CREATE INDEX "MileageEntry_propertyId_date_idx" ON "MileageEntry"("propertyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Category_kind_name_parent_key" ON "Category"("kind", "name", "parent");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MileageEntry" ADD CONSTRAINT "MileageEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

