-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PriceListStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('UNIT', 'THOUSAND_UNITS', 'M2', 'ML', 'KG', 'TON', 'BOX', 'PACK', 'PALLET', 'SERVICE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PriceItemStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "title" TEXT,
    "documentUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" "PriceListStatus" NOT NULL DEFAULT 'UPLOADED',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "rawText" TEXT,
    "rawData" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "descriptionRaw" TEXT NOT NULL,
    "descriptionNormalized" TEXT,
    "channel" TEXT,
    "priceAmount" DECIMAL(14,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "priceUnit" "PriceUnit" NOT NULL DEFAULT 'UNKNOWN',
    "priceQuantityBase" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "rawUnitLabel" TEXT,
    "normalizedUnitPrice" DECIMAL(14,6),
    "normalizedUnit" "PriceUnit",
    "discountPercent" DECIMAL(8,4),
    "taxPercent" DECIMAL(8,4),
    "status" "PriceItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "rowIndex" INTEGER,
    "pageNumber" INTEGER,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalProduct" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "defaultUnit" "PriceUnit" NOT NULL DEFAULT 'UNKNOWN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProductAlias" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "canonicalProductId" TEXT,
    "priceListItemId" TEXT,
    "aliasRaw" TEXT NOT NULL,
    "aliasNormalized" TEXT,
    "confidence" DECIMAL(5,4),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_taxId_idx" ON "Supplier"("taxId");

-- CreateIndex
CREATE INDEX "PriceList_supplierId_idx" ON "PriceList"("supplierId");

-- CreateIndex
CREATE INDEX "PriceList_status_idx" ON "PriceList"("status");

-- CreateIndex
CREATE INDEX "PriceList_validFrom_idx" ON "PriceList"("validFrom");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId");

-- CreateIndex
CREATE INDEX "PriceListItem_supplierId_idx" ON "PriceListItem"("supplierId");

-- CreateIndex
CREATE INDEX "PriceListItem_canonicalProductId_idx" ON "PriceListItem"("canonicalProductId");

-- CreateIndex
CREATE INDEX "PriceListItem_descriptionNormalized_idx" ON "PriceListItem"("descriptionNormalized");

-- CreateIndex
CREATE INDEX "PriceListItem_priceUnit_idx" ON "PriceListItem"("priceUnit");

-- CreateIndex
CREATE INDEX "PriceListItem_channel_idx" ON "PriceListItem"("channel");

-- CreateIndex
CREATE INDEX "CanonicalProduct_name_idx" ON "CanonicalProduct"("name");

-- CreateIndex
CREATE INDEX "CanonicalProduct_category_idx" ON "CanonicalProduct"("category");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_supplierId_idx" ON "SupplierProductAlias"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_canonicalProductId_idx" ON "SupplierProductAlias"("canonicalProductId");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_aliasNormalized_idx" ON "SupplierProductAlias"("aliasNormalized");

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_priceListItemId_fkey" FOREIGN KEY ("priceListItemId") REFERENCES "PriceListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
