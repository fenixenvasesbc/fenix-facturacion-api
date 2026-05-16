CREATE TYPE "InvoiceBillingResult" AS ENUM (
    'OK',
    'NO_OVERCHARGE',
    'OVERCHARGED',
    'NEEDS_REVIEW'
);

ALTER TABLE "Invoice" ADD COLUMN "billingResult" "InvoiceBillingResult";

CREATE INDEX "Invoice_billingResult_idx" ON "Invoice"("billingResult");
