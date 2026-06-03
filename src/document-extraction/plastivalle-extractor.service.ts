import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class PlastivalleExtractorService {
  supports(input: DocumentExtractionInput) {
    return this.normalize(input.supplierName ?? '').includes('plastivalle');
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    return this.dedupeItems([
      ...this.extractInvoiceFromText(input.rawText ?? ''),
      ...this.extractInvoiceFromRawData(input.rawData),
    ]);
  }

  private extractInvoiceFromText(rawText: string) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return this.extractInvoiceFromLines(lines, 1);
  }

  private extractInvoiceFromRawData(rawData?: Prisma.JsonValue | null) {
    const items: ExtractedInvoiceItem[] = [];

    for (const table of this.getTables(rawData)) {
      const lines = (table.rows ?? [])
        .map((row) => this.cleanCells(row).join(' '))
        .filter(Boolean);

      items.push(...this.extractInvoiceFromLines(lines, table.page));
    }

    return items;
  }

  private extractInvoiceFromLines(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const normalized = this.normalize(line);

      if (this.isNoiseLine(normalized) || this.isNumericLine(line)) {
        index += 1;
        continue;
      }

      const inlineItem = this.extractInlineItem(lines, index, pageNumber);

      if (inlineItem) {
        items.push(inlineItem.item);
        index = inlineItem.nextIndex;
        continue;
      }

      const blockItem = this.extractBlockItem(lines, index, pageNumber);

      if (blockItem) {
        items.push(blockItem.item);
        index = blockItem.nextIndex;
        continue;
      }

      index += 1;
    }

    return items;
  }

  private extractInlineItem(
    lines: string[],
    index: number,
    pageNumber?: number,
  ) {
    const line = lines[index];
    const inlineMatch = /^([A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*)\s+(.+)$/i.exec(line);

    if (!inlineMatch) {
      return undefined;
    }

    const reference = this.normalizeReference(inlineMatch[1]);
    const descriptionRaw = inlineMatch[2].trim();

    if (!this.isProductReference(reference) || !descriptionRaw) {
      return undefined;
    }

    const values = this.resolveFollowingValues(lines, index + 1);

    if (!values) {
      return undefined;
    }

    return {
      item: this.toInvoiceItem({
        descriptionRaw,
        reference,
        quantityThousands: values.quantityThousands,
        pricePerThousand: values.pricePerThousand,
        totalAmount: values.totalAmount,
        rowIndex: index,
        pageNumber,
        sourceLines: lines.slice(index, values.nextIndex),
        extractorName: 'plastivalle-invoice-inline',
      }),
      nextIndex: values.nextIndex,
    };
  }

  private extractBlockItem(
    lines: string[],
    index: number,
    pageNumber?: number,
  ) {
    const reference = this.normalizeReference(lines[index]);

    if (!this.isProductReference(reference)) {
      return undefined;
    }

    const descriptionRaw = lines[index + 1]?.trim();

    if (!descriptionRaw || this.isNumericLine(descriptionRaw)) {
      return undefined;
    }

    const values = this.resolveFollowingValues(lines, index + 2);

    if (!values) {
      return undefined;
    }

    return {
      item: this.toInvoiceItem({
        descriptionRaw,
        reference,
        quantityThousands: values.quantityThousands,
        pricePerThousand: values.pricePerThousand,
        totalAmount: values.totalAmount,
        rowIndex: index,
        pageNumber,
        sourceLines: lines.slice(index, values.nextIndex),
        extractorName: 'plastivalle-invoice-block',
      }),
      nextIndex: values.nextIndex,
    };
  }

  private resolveFollowingValues(lines: string[], startIndex: number) {
    const numericLines: string[] = [];
    let cursor = startIndex;

    while (cursor < lines.length && numericLines.length < 3) {
      const line = lines[cursor];

      if (this.isNoiseLine(this.normalize(line))) {
        break;
      }

      if (this.isNumericLine(line)) {
        numericLines.push(line);
        cursor += 1;
        continue;
      }

      break;
    }

    if (numericLines.length < 3) {
      return undefined;
    }

    const quantityThousands = this.parseLocaleNumber(numericLines[0]);
    const pricePerThousand = this.parseLocaleNumber(numericLines[1]);
    const totalAmount = this.parseLocaleNumber(numericLines[2]);

    if (
      quantityThousands === undefined ||
      pricePerThousand === undefined ||
      totalAmount === undefined
    ) {
      return undefined;
    }

    const expected = quantityThousands * pricePerThousand;

    if (Math.abs(expected - totalAmount) > 0.05) {
      return undefined;
    }

    return {
      quantityThousands,
      pricePerThousand,
      totalAmount,
      nextIndex: cursor,
    };
  }

  private toInvoiceItem(input: {
    descriptionRaw: string;
    reference: string;
    quantityThousands: number;
    pricePerThousand: number;
    totalAmount: number;
    rowIndex: number;
    pageNumber?: number;
    sourceLines: string[];
    extractorName: string;
  }): ExtractedInvoiceItem {
    const matchCode = this.resolveMatchCode(
      input.reference,
      input.descriptionRaw,
    );
    const quantity = input.quantityThousands * 1000;
    const unitPrice = input.pricePerThousand / 1000;

    return {
      descriptionRaw: input.descriptionRaw,
      descriptionNormalized: this.normalize(input.descriptionRaw),
      matchCode,
      reference: input.reference,
      quantity: this.decimalString(quantity, 4),
      unit: PriceUnit.UNIT,
      unitPrice: this.decimalString(unitPrice, 6),
      totalAmount: this.decimalString(input.totalAmount, 4),
      currency: 'EUR',
      rowIndex: input.rowIndex,
      pageNumber: input.pageNumber,
      confidence: 0.94,
      warnings: [],
      rawData: {
        extractor: {
          name: input.extractorName,
          reference: input.reference,
          originalQuantityThousands: this.decimalString(
            input.quantityThousands,
            4,
          ),
          originalPricePerThousand: this.decimalString(
            input.pricePerThousand,
            6,
          ),
          sourceLines: input.sourceLines,
        },
      },
    };
  }

  private resolveMatchCode(reference: string, descriptionRaw: string) {
    return reference || this.deriveMatchCodeFromDescription(descriptionRaw);
  }

  private deriveMatchCodeFromDescription(descriptionRaw: string) {
    const features = this.extractBagFeatures(descriptionRaw);

    if (!features) {
      return undefined;
    }

    return `GEN${features.size}${features.color}`;
  }

  private extractBagFeatures(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (!normalized.includes('bolsa') || !normalized.includes('asa')) {
      return undefined;
    }

    const size = /(\d+)\s*[x+]\s*(\d+)\s*x\s*(\d+)/i.exec(descriptionRaw);
    const color = normalized.includes('blanc')
      ? 'B'
      : normalized.includes('marron') || normalized.includes('marr')
        ? 'M'
        : normalized.includes('negra')
          ? 'N'
          : normalized.includes('fucsia')
            ? 'FUC'
            : normalized.includes('kraft')
              ? 'K'
              : undefined;
    const handle = normalized.includes('plana')
      ? 'PLANA'
      : normalized.includes('retorcida')
        ? 'RETORCIDA'
        : undefined;

    if (!size || !color || !handle) {
      return undefined;
    }

    return {
      size: `${size[1]}${size[2]}${size[3]}`,
      color,
      handle,
    };
  }

  private isProductReference(value: string) {
    return /^[A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*$/.test(value);
  }

  private normalizeReference(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private dedupeItems(items: ExtractedInvoiceItem[]) {
    const deduped = new Map<string, ExtractedInvoiceItem>();

    for (const item of items) {
      const key = [
        item.descriptionNormalized || this.normalize(item.descriptionRaw),
        item.quantity ?? '',
        item.unitPrice,
        item.totalAmount ?? '',
      ].join('|');
      const previous = deduped.get(key);

      if (!previous || this.isBetterDuplicate(item, previous)) {
        deduped.set(key, item);
      }
    }

    return [...deduped.values()];
  }

  private isBetterDuplicate(
    candidate: ExtractedInvoiceItem,
    current: ExtractedInvoiceItem,
  ) {
    const derived = this.deriveMatchCodeFromDescription(candidate.descriptionRaw);

    if (derived) {
      const candidateMatchesDescription =
        this.normalizeReference(candidate.matchCode ?? '') ===
        this.normalizeReference(derived);
      const currentMatchesDescription =
        this.normalizeReference(current.matchCode ?? '') ===
        this.normalizeReference(derived);

      if (candidateMatchesDescription !== currentMatchesDescription) {
        return candidateMatchesDescription;
      }
    }

    return (
      !current.matchCode &&
      Boolean(candidate.matchCode) &&
      candidate.confidence >= current.confidence
    );
  }

  private isNumericLine(value: string) {
    return this.parseLocaleNumber(value) !== undefined;
  }

  private parseLocaleNumber(value: string) {
    const clean = value.trim().replace(/\s/g, '');

    if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:[,.]\d+)?$/.test(clean)) {
      return undefined;
    }

    if (clean.includes(',') && clean.includes('.')) {
      return Number(clean.replace(/\./g, '').replace(',', '.'));
    }

    if (/^-?\d{1,3}(?:\.\d{3})+$/.test(clean)) {
      return Number(clean.replace(/\./g, ''));
    }

    return Number(clean.replace(',', '.'));
  }

  private isNoiseLine(normalizedLine: string) {
    return [
      'factura',
      'albaran',
      'dante envases',
      'plastivalle',
      'codigo',
      'cod articulo',
      'descripcion',
      'cantidad',
      'precio',
      'importe',
      'desglose',
      'base imponible',
      'suma bruto',
      'total iva',
      'total',
      'observaciones',
      'forma de pago',
      'responsable',
      'entrega a cuenta',
      'bultos',
      'lote',
    ].some((term) => normalizedLine.includes(term));
  }

  private getTables(rawData?: Prisma.JsonValue | null): OcrTable[] {
    const raw = rawData as
      | {
          ocr?: {
            tables?: OcrTable[];
          };
        }
      | null
      | undefined;

    return raw?.ocr?.tables ?? [];
  }

  private cleanCells(row: string[]) {
    return row.map((cell) => String(cell).trim()).filter(Boolean);
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
