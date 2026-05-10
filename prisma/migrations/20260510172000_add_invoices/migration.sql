CREATE TYPE "InvoiceStatus" AS ENUM (
    'UPLOADED',
    'PROCESSING_OCR',
    'OCR_PROCESSED',
    'PARSING',
    'VALIDATING',
    'VALIDATED',
    'FAILED'
);

CREATE TYPE "InvoiceItemValidationStatus" AS ENUM (
    'OK',
    'SOBRECOSTE',
    'PRECIO_MENOR',
    'PRODUCTO_NO_ENCONTRADO',
    'UNIDAD_INCOMPATIBLE',
    'REQUIERE_REVISION'
);

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "title" TEXT,
    "documentUrl" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UPLOADED',
    "invoiceNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "rawData" JSONB,
    "validationStatus" TEXT,
    "validationResult" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "matchedPriceListItemId" TEXT,
    "canonicalProductId" TEXT,
    "descriptionRaw" TEXT NOT NULL,
    "descriptionNormalized" TEXT,
    "quantity" DECIMAL(14,4),
    "unit" "PriceUnit" NOT NULL DEFAULT 'UNKNOWN',
    "unitPrice" DECIMAL(14,6) NOT NULL,
    "totalAmount" DECIMAL(14,4),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "discountPercent" DECIMAL(8,4),
    "taxPercent" DECIMAL(8,4),
    "validationStatus" "InvoiceItemValidationStatus" NOT NULL DEFAULT 'REQUIERE_REVISION',
    "differencePercent" DECIMAL(10,4),
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Invoice_supplierId_idx" ON "Invoice"("supplierId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");
CREATE INDEX "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_supplierId_idx" ON "InvoiceItem"("supplierId");
CREATE INDEX "InvoiceItem_matchedPriceListItemId_idx" ON "InvoiceItem"("matchedPriceListItemId");
CREATE INDEX "InvoiceItem_canonicalProductId_idx" ON "InvoiceItem"("canonicalProductId");
CREATE INDEX "InvoiceItem_descriptionNormalized_idx" ON "InvoiceItem"("descriptionNormalized");
CREATE INDEX "InvoiceItem_validationStatus_idx" ON "InvoiceItem"("validationStatus");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_matchedPriceListItemId_fkey" FOREIGN KEY ("matchedPriceListItemId") REFERENCES "PriceListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
