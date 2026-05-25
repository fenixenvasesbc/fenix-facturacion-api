ALTER TABLE "PriceListItem"
ADD COLUMN "matchCode" TEXT,
ADD COLUMN "lengthMm" DECIMAL(14,4),
ADD COLUMN "widthMm" DECIMAL(14,4),
ADD COLUMN "heightMm" DECIMAL(14,4);

CREATE TABLE "PriceListItemPrice" (
    "id" TEXT NOT NULL,
    "priceListItemId" TEXT NOT NULL,
    "minQuantity" DECIMAL(14,4),
    "maxQuantity" DECIMAL(14,4),
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
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItemPrice_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InvoiceItem"
ADD COLUMN "matchedPriceListItemPriceId" TEXT,
ADD COLUMN "matchCode" TEXT,
ADD COLUMN "lengthMm" DECIMAL(14,4),
ADD COLUMN "widthMm" DECIMAL(14,4),
ADD COLUMN "heightMm" DECIMAL(14,4);

CREATE INDEX "PriceListItem_matchCode_idx" ON "PriceListItem"("matchCode");
CREATE INDEX "PriceListItemPrice_priceListItemId_idx" ON "PriceListItemPrice"("priceListItemId");
CREATE INDEX "PriceListItemPrice_minQuantity_idx" ON "PriceListItemPrice"("minQuantity");
CREATE INDEX "PriceListItemPrice_maxQuantity_idx" ON "PriceListItemPrice"("maxQuantity");
CREATE INDEX "PriceListItemPrice_status_idx" ON "PriceListItemPrice"("status");
CREATE INDEX "InvoiceItem_matchedPriceListItemPriceId_idx" ON "InvoiceItem"("matchedPriceListItemPriceId");
CREATE INDEX "InvoiceItem_matchCode_idx" ON "InvoiceItem"("matchCode");

ALTER TABLE "PriceListItemPrice"
ADD CONSTRAINT "PriceListItemPrice_priceListItemId_fkey"
FOREIGN KEY ("priceListItemId") REFERENCES "PriceListItem"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceItem"
ADD CONSTRAINT "InvoiceItem_matchedPriceListItemPriceId_fkey"
FOREIGN KEY ("matchedPriceListItemPriceId") REFERENCES "PriceListItemPrice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
