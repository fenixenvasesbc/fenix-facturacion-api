import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class DrakoExtractorService {
  supports(input: DocumentExtractionInput) {
    return this.normalize(input.supplierName ?? '').includes('drako');
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

    return this.extractInvoiceFromLines(lines, 1);
  }

  private extractInvoiceFromTables(
    rawData?: Prisma.JsonValue | null,
  ): ExtractedInvoiceItem[] {
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

      if (this.isNoiseLine(normalized) || !/[a-z]/i.test(line)) {
        index += 1;
        continue;
      }

      const descriptionParts = [line];
      let cursor = index + 1;

      while (
        cursor < lines.length &&
        !this.isNumericLine(lines[cursor]) &&
        !this.isArticleCode(lines[cursor]) &&
        !this.isNoiseLine(this.normalize(lines[cursor]))
      ) {
        descriptionParts.push(lines[cursor]);
        cursor += 1;
      }

      let reference: string | undefined;

      if (cursor < lines.length && this.isArticleCode(lines[cursor])) {
        reference = lines[cursor];
        cursor += 1;
      }

      const numericLines = lines.slice(cursor, cursor + 4);

      if (numericLines.length < 4 || !numericLines.every((value) => this.isNumericLine(value))) {
        index += 1;
        continue;
      }

      const quantity = this.parseLocaleNumber(numericLines[0]);
      const unitPrice = this.parseLocaleNumber(numericLines[1]);
      const subtotal = this.parseLocaleNumber(numericLines[2]);
      const totalAmount = this.parseLocaleNumber(numericLines[3]);

      if (
        quantity === undefined ||
        unitPrice === undefined ||
        totalAmount === undefined
      ) {
        index += 1;
        continue;
      }

      const descriptionRaw = descriptionParts.join(' ').replace(/\s+/g, ' ').trim();
      const matchCode = this.resolveMatchCode(descriptionRaw);
      const warnings = this.validateLineMath(quantity, unitPrice, totalAmount);

      items.push({
        descriptionRaw,
        descriptionNormalized: this.normalize(descriptionRaw),
        matchCode,
        reference,
        quantity: this.decimalString(quantity, 4),
        unit: PriceUnit.UNIT,
        unitPrice: this.decimalString(unitPrice, 6),
        totalAmount: this.decimalString(totalAmount, 4),
        currency: 'EUR',
        rowIndex: index,
        pageNumber,
        confidence: warnings.length === 0 ? 0.94 : 0.82,
        warnings,
        rawData: {
          extractor: {
            name: 'drako-invoice',
            reference,
            subtotal:
              subtotal === undefined ? undefined : this.decimalString(subtotal, 4),
            sourceLines: lines.slice(index, cursor + 4),
          },
        },
      });

      index = cursor + 4;
    }

    return items;
  }

  private resolveMatchCode(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (normalized.includes('vaso')) {
      return 'DRAKO_LAMINAS_1_CARA';
    }

    if (
      normalized.includes('hamburguesa') ||
      normalized.includes('hamburguesas') ||
      normalized.includes('burger')
    ) {
      return 'DRAKO_LAMINAS_2_CARAS';
    }

    if (normalized.includes('pegatina')) {
      return this.resolveStickerMatchCode(normalized);
    }

    if (normalized.includes('adhesivo')) {
      return this.resolveStickerMatchCode(normalized);
    }

    if (normalized.includes('antigrasa')) {
      return this.resolveAntigrasaMatchCode(descriptionRaw);
    }

    if (normalized.includes('mantel')) {
      if (normalized.includes('blanco') && normalized.includes('kraft')) {
        return 'DRAKO_MANTELES_BLANCO_KRAFT';
      }

      if (normalized.includes('kraft')) {
        return 'DRAKO_MANTELES_KRAFT';
      }

      if (normalized.includes('blanco')) {
        return 'DRAKO_MANTELES_BLANCO';
      }

      return 'DRAKO_MANTELES';
    }

    if (normalized.includes('lamina') && normalized.includes('2 cara')) {
      return 'DRAKO_LAMINAS_2_CARAS';
    }

    if (normalized.includes('lamina')) {
      return 'DRAKO_LAMINAS_1_CARA';
    }

    return undefined;
  }

  private resolveStickerMatchCode(normalized: string) {
    const shape = normalized.includes('redond')
      ? 'REDONDO'
      : normalized.includes('cuadrad')
        ? 'CUADRADO'
        : undefined;
    const size = /\b(5|7)\s*cm\b/.exec(normalized)?.[1];

    if (shape && size) {
      return `DRAKO_ADHESIVO_${shape}_${size}CM`;
    }

    return 'DRAKO_ADHESIVOS';
  }

  private resolveAntigrasaMatchCode(descriptionRaw: string) {
    const normalizedSize = this.extractNormalizedSize(descriptionRaw);

    if (normalizedSize === '25X28') {
      return 'DRAKO_ANTIGRASA_25X28';
    }

    if (['31X31', '28X34', '28X31'].includes(normalizedSize ?? '')) {
      return 'DRAKO_ANTIGRASA_31X31_28X34_28X31';
    }

    if (normalizedSize === '30X40') {
      return 'DRAKO_ANTIGRASA_30X40';
    }

    if (normalizedSize === '16X28') {
      return 'DRAKO_ANTIGRASA_16X28';
    }

    return 'DRAKO_ANTIGRASA';
  }

  private extractNormalizedSize(value: string) {
    const match = /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)/i.exec(value);

    if (!match) {
      return undefined;
    }

    const first = this.parseLocaleNumber(match[1]);
    const second = this.parseLocaleNumber(match[2]);

    if (first === undefined || second === undefined) {
      return undefined;
    }

    return `${this.formatSizePart(first)}X${this.formatSizePart(second)}`;
  }

  private formatSizePart(value: number) {
    return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
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

  private isArticleCode(value: string) {
    return /^\d{5,}$/.test(value.trim());
  }

  private isNumericLine(value: string) {
    return this.parseLocaleNumber(value) !== undefined;
  }

  private isNoiseLine(normalizedLine: string) {
    if (
      /^es\d/.test(normalizedLine) ||
      /^\d+\s+\d+$/.test(normalizedLine) ||
      /^\d{2}\s+\d{2}\s+\d{4}$/.test(normalizedLine)
    ) {
      return true;
    }

    return [
      'www 1kbcode com',
      'documento',
      'numero',
      'pagina',
      'fecha',
      'n i f',
      'agente',
      'forma de pago',
      'articulo',
      'descripcion',
      'cantidad',
      'precio ud',
      'subtotal',
      'dto',
      'total',
      'tipo',
      'importe',
      'descuento',
      'pronto pago',
      'portes',
      'financiacion',
      'base',
      'i v a',
      'observaciones',
      'vencimientos',
      'domiciliacion',
      'numero de cuenta',
      'factura',
      'oficina',
      'drako impresores',
      'dante envases',
      'albar',
      'transferencia',
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

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
