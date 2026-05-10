-- Replace PriceListStatus values with pipeline-specific states.
-- Existing PROCESSING rows continue as PROCESSING_OCR.
-- Existing PROCESSED rows become READY because previous code used PROCESSED after OCR,
-- and the automatic pipeline now uses READY as the final frontend state.

ALTER TYPE "PriceListStatus" RENAME TO "PriceListStatus_old";

CREATE TYPE "PriceListStatus" AS ENUM (
    'UPLOADED',
    'PROCESSING_OCR',
    'OCR_PROCESSED',
    'PARSING',
    'READY',
    'FAILED'
);

ALTER TABLE "PriceList"
ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "PriceList"
ALTER COLUMN "status" TYPE "PriceListStatus"
USING (
    CASE "status"::text
        WHEN 'PROCESSING' THEN 'PROCESSING_OCR'
        WHEN 'PROCESSED' THEN 'READY'
        ELSE "status"::text
    END
)::"PriceListStatus";

ALTER TABLE "PriceList"
ALTER COLUMN "status" SET DEFAULT 'UPLOADED';

DROP TYPE "PriceListStatus_old";
