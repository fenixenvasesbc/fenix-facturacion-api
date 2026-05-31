import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class InterpackExtractorService {
  supports(input: DocumentExtractionInput) {
    return this.normalize(input.supplierName ?? '').includes('interpack');
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    const textItems = this.extractInvoiceFromText(input.rawText ?? '');

    if (textItems.length > 0) {
      return textItems;
    }

    return this.extractInvoiceFromTables(input.rawData);
  }

  private extractInvoiceFromText(rawText: string) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return this.dedupeItems([
      ...this.extractModernInvoice(lines, 1),
      ...this.extractLegacyInvoice(lines, 1),
    ]);
  }

  private extractInvoiceFromTables(
    rawData?: Prisma.JsonValue | null,
  ): ExtractedInvoiceItem[] {
    const items: ExtractedInvoiceItem[] = [];

    for (const table of this.getTables(rawData)) {
      const lines = (table.rows ?? [])
        .map((row) => this.cleanCells(row).join(' '))
        .filter(Boolean);

      items.push(
        ...this.extractModernInvoice(lines, table.page),
        ...this.extractLegacyInvoice(lines, table.page),
      );
    }

    return this.dedupeItems(items);
  }

  private extractModernInvoice(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const normalized = this.normalize(line);

      if (this.isNoiseLine(normalized) || this.isNumericLine(line)) {
        index += 1;
        continue;
      }

      const referenceIndex = this.findReferenceIndex(lines, index + 1);

      if (referenceIndex === undefined || referenceIndex - index > 3) {
        index += 1;
        continue;
      }

      const numericLines = lines.slice(referenceIndex + 1, referenceIndex + 4);

      if (
        numericLines.length < 3 ||
        !numericLines.every((value) => this.isNumericLine(value))
      ) {
        index += 1;
        continue;
      }

      const quantityRaw = this.parseLocaleNumber(numericLines[0]);
      const priceRaw = this.parseLocaleNumber(numericLines[1]);
      const totalAmount = this.parseLocaleNumber(numericLines[2]);

      if (
        quantityRaw === undefined ||
        priceRaw === undefined ||
        totalAmount === undefined ||
        priceRaw < 0 ||
        totalAmount < 0
      ) {
        index += 1;
        continue;
      }

      const descriptionRaw = lines
        .slice(index, referenceIndex)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const reference = this.normalizeReference(lines[referenceIndex]);
      const isBag = this.normalize(descriptionRaw).includes('bolsa');
      const quantity = isBag ? quantityRaw * 1000 : quantityRaw;
      const unitPrice = isBag ? priceRaw / 1000 : priceRaw;

      items.push(
        this.toInvoiceItem({
          descriptionRaw,
          reference,
          quantity,
          unitPrice,
          totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(index, referenceIndex + 4),
          extractorName: 'interpack-invoice-modern',
          originalQuantity: quantityRaw,
          originalUnitPrice: priceRaw,
        }),
      );

      index = referenceIndex + 4;
    }

    return items;
  }

  private extractLegacyInvoice(lines: string[], pageNumber?: number) {
    const items: ExtractedInvoiceItem[] = [];

    for (let index = 0; index < lines.length - 2; index += 1) {
      const normalized = this.normalize(lines[index]);

      if (
        this.isNoiseLine(normalized) ||
        this.isNumericLine(lines[index]) ||
        this.extractNumbers(lines[index]).length >= 2 ||
        !this.isLegacyCategoryLine(normalized)
      ) {
        continue;
      }

      const descriptionIndex = index + 1;
      const descriptionRaw = lines[descriptionIndex];
      const descriptionNormalized = this.normalize(descriptionRaw);

      if (
        this.isNoiseLine(descriptionNormalized) ||
        this.isNumericLine(descriptionRaw) ||
        descriptionNormalized.includes('cliche')
      ) {
        continue;
      }

      const numericIndex = this.findLegacyNumericIndex(
        lines,
        descriptionIndex + 1,
      );

      if (numericIndex === undefined) {
        continue;
      }

      const numbers = this.extractNumbers(lines[numericIndex]);
      const totalAmount = this.parseLocaleNumber(lines[numericIndex + 1] ?? '');

      if (
        numbers.length < 2 ||
        totalAmount === undefined ||
        numbers[1] < 0 ||
        totalAmount < 0
      ) {
        continue;
      }

      const isMillar = this.normalize(descriptionRaw).includes('millar');
      const quantity = isMillar ? numbers[0] * 1000 : numbers[0];
      const unitPrice = isMillar ? numbers[1] / 1000 : numbers[1];

      items.push(
        this.toInvoiceItem({
          descriptionRaw,
          quantity,
          unitPrice,
          totalAmount,
          rowIndex: index,
          pageNumber,
          sourceLines: lines.slice(index, numericIndex + 2),
          extractorName: 'interpack-invoice-legacy',
          originalQuantity: numbers[0],
          originalUnitPrice: numbers[1],
        }),
      );
    }

    return items;
  }

  private toInvoiceItem(input: {
    descriptionRaw: string;
    reference?: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    rowIndex: number;
    pageNumber?: number;
    sourceLines: string[];
    extractorName: string;
    originalQuantity?: number;
    originalUnitPrice?: number;
  }): ExtractedInvoiceItem {
    const matchCode = this.resolveMatchCode(
      input.descriptionRaw,
      input.reference,
    );
    const warnings = this.validateLineMath(
      input.quantity,
      input.unitPrice,
      input.totalAmount,
    );

    return {
      descriptionRaw: input.descriptionRaw,
      descriptionNormalized: this.normalize(input.descriptionRaw),
      matchCode,
      reference: input.reference,
      quantity: this.decimalString(input.quantity, 4),
      unit: PriceUnit.UNIT,
      unitPrice: this.decimalString(input.unitPrice, 6),
      totalAmount: this.decimalString(input.totalAmount, 4),
      currency: 'EUR',
      rowIndex: input.rowIndex,
      pageNumber: input.pageNumber,
      confidence: warnings.length === 0 ? 0.94 : 0.82,
      warnings,
      rawData: {
        extractor: {
          name: input.extractorName,
          reference: input.reference,
          originalQuantity:
            input.originalQuantity === undefined
              ? undefined
              : this.decimalString(input.originalQuantity, 4),
          originalUnitPrice:
            input.originalUnitPrice === undefined
              ? undefined
              : this.decimalString(input.originalUnitPrice, 6),
          sourceLines: input.sourceLines,
        },
      },
    };
  }

  private resolveMatchCode(descriptionRaw: string, reference?: string) {
    const normalized = this.normalize(descriptionRaw);

    if (normalized.includes('resma') || normalized.includes('antigrasa')) {
      return this.resolveResmaMatchCode(descriptionRaw);
    }

    if (reference && normalized.includes('bolsa')) {
      return reference;
    }

    return reference;
  }

  private resolveResmaMatchCode(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (
      normalized.includes('antigrasa') &&
      /75\s*[x*]\s*100/i.test(descriptionRaw) &&
      /500\s*h/i.test(descriptionRaw)
    ) {
      return 'INTERPACK_RESMA_ANTIGRASA_75X100_500H';
    }

    if (normalized.includes('celulosa')) {
      const gramaje = /(\d+(?:[,.]\d+)?)\s*gr/i.exec(descriptionRaw)?.[1];

      return gramaje
        ? `INTERPACK_CELULOSA_${this.formatMeasureToken(gramaje)}G`
        : 'INTERPACK_CELULOSA';
    }

    if (normalized.includes('antigrasa')) {
      const cutMatch =
        /corte\s*(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)/i.exec(
          descriptionRaw,
        );
      const anySizeMatch =
        /(\d+(?:[,.]\d+)?)\s*[x*]\s*(\d+(?:[,.]\d+)?)\s*cm?\s*millar/i.exec(
          descriptionRaw,
        );
      const sizeMatch = cutMatch ?? anySizeMatch;

      if (sizeMatch) {
        return `INTERPACK_RESMA_ANTIGRASA_CORTE_${this.normalizeCutMeasure(
          sizeMatch[1],
          sizeMatch[2],
        )}`;
      }

      const widthMatch = /(\d+(?:[,.]\d+)?)\s*[x*]\s*86/i.exec(descriptionRaw);

      if (widthMatch) {
        return `INTERPACK_RESMA_ANTIGRASA_ANCHO_${this.formatMeasureToken(
          widthMatch[1],
        )}`;
      }

      return 'INTERPACK_RESMA_ANTIGRASA';
    }

    return undefined;
  }

  private normalizeCutMeasure(firstRaw: string, secondRaw: string) {
    const first = this.measureInteger(firstRaw);
    const second = this.measureInteger(secondRaw);
    const ordered = [first, second].sort((left, right) => left - right);

    return `${ordered[0]}X${ordered[1]}`;
  }

  private measureInteger(value: string) {
    const parsed = this.parseLocaleNumber(value);

    if (parsed === undefined) {
      return 0;
    }

    return Math.trunc(parsed);
  }

  private findReferenceIndex(lines: string[], startIndex: number) {
    for (
      let index = startIndex;
      index < Math.min(lines.length, startIndex + 4);
      index += 1
    ) {
      if (this.isInterpackReference(lines[index])) {
        return index;
      }
    }

    return undefined;
  }

  private findLegacyNumericIndex(lines: string[], startIndex: number) {
    for (
      let index = startIndex;
      index < Math.min(lines.length, startIndex + 4);
      index += 1
    ) {
      const numbers = this.extractNumbers(lines[index]);

      if (numbers.length >= 2) {
        return index;
      }
    }

    return undefined;
  }

  private isInterpackReference(value: string) {
    const clean = this.normalizeReference(value);

    return (
      /^[A-Z0-9]{3,}$/.test(clean) && /[A-Z]/.test(clean) && /\d/.test(clean)
    );
  }

  private normalizeReference(value: string) {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private isLegacyCategoryLine(normalized: string) {
    return (
      normalized.includes('resma') ||
      normalized.includes('papel antigra') ||
      normalized.includes('p antigra') ||
      normalized.includes('cliches')
    );
  }

  private validateLineMath(
    quantity: number,
    unitPrice: number,
    totalAmount: number,
  ) {
    const expected = quantity * unitPrice;
    const difference = Math.abs(expected - totalAmount);

    if (difference > 0.05) {
      return [
        `Importe no cuadra: ${this.decimalString(quantity, 4)} * ${this.decimalString(unitPrice, 6)} = ${this.decimalString(expected, 2)} vs ${this.decimalString(totalAmount, 2)}`,
      ];
    }

    return [];
  }

  private dedupeItems(items: ExtractedInvoiceItem[]) {
    const seen = new Set<string>();

    return items.filter((item) => {
      const key = [
        item.descriptionRaw,
        item.reference ?? '',
        item.quantity ?? '',
        item.unitPrice,
        item.totalAmount ?? '',
      ].join('|');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private isNumericLine(value: string) {
    return this.parseLocaleNumber(value) !== undefined;
  }

  private extractNumbers(value: string) {
    return Array.from(
      value.matchAll(/-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[,.]\d+)?/g),
    )
      .map((match) => this.parseLocaleNumber(match[0]))
      .filter((value): value is number => value !== undefined);
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

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private formatMeasureToken(value: string) {
    return value
      .replace(',', '_')
      .replace('.', '_')
      .replace(/[^0-9_]/g, '');
  }

  private isNoiseLine(normalizedLine: string) {
    return [
      'factura',
      'interpack embalajes',
      'cliente',
      'codigo',
      'descripcion',
      'cantidad',
      'precio',
      'importe',
      'subtotal',
      'total',
      'iva',
      'base imponible',
      'fecha',
      'vencimiento',
      'forma de pago',
      'observaciones',
      'referencia',
      'albaran',
      'domiciliacion',
      'abono error',
      'abono',
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

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
