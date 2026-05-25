import { PriceUnit, Prisma } from '@prisma/client';

export interface DocumentExtractionInput {
  supplierName?: string | null;
  rawText?: string | null;
  rawData?: Prisma.JsonValue | null;
}

export interface ExtractedPriceListItem {
  descriptionRaw: string;
  descriptionNormalized: string;
  matchCode?: string;
  channel?: string;
  lengthMm?: string;
  widthMm?: string;
  heightMm?: string;
  priceAmount: string;
  currency: string;
  priceUnit: PriceUnit;
  priceQuantityBase: string;
  rawUnitLabel?: string;
  normalizedUnitPrice?: string;
  normalizedUnit?: PriceUnit;
  rowIndex: number;
  pageNumber?: number;
  confidence: number;
  warnings: string[];
  rawData: Prisma.InputJsonObject;
}

export interface ExtractedInvoiceItem {
  descriptionRaw: string;
  descriptionNormalized: string;
  matchCode?: string;
  lengthMm?: string;
  widthMm?: string;
  heightMm?: string;
  reference?: string;
  size?: string;
  channel?: string;
  quantity?: string;
  unit: PriceUnit;
  unitPrice: string;
  totalAmount?: string;
  currency: string;
  rowIndex: number;
  pageNumber?: number;
  confidence: number;
  warnings: string[];
  rawData: Prisma.InputJsonObject;
}

export interface OcrTable {
  page?: number;
  rows?: string[][];
}
