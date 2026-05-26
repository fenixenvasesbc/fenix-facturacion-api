import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

interface PendingLine {
  code: string;
  descriptionParts: string[];
  amountParts: number[];
  rowIndex: number;
  pageNumber?: number;
  sourceLines: string[];
}

@Injectable()
export class SotoExtractorService {
  supports(input: DocumentExtractionInput) {
    const supplierName = this.normalize(input.supplierName ?? '');

    return supplierName.includes('soto');
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
    let pending: PendingLine | undefined;
    let insideItems = false;

    for (const [rowIndex, line] of lines.entries()) {
      const normalized = this.normalize(line);

      if (normalized.includes('albar')) {
        insideItems = true;
        continue;
      }

      if (this.isEndOfItems(normalized)) {
        break;
      }

      if (!insideItems && !/^101(?:\s|$)/i.test(line)) {
        continue;
      }

      if (this.isNoiseLine(normalized)) {
        continue;
      }

      const fullLine = this.parseFullLine(line, rowIndex, pageNumber);

      if (fullLine) {
        items.push(fullLine.item);
        pending = undefined;
        continue;
      }

      const amountLine = this.parseAmountsLine(line);

      if (pending && amountLine) {
        const item = this.finalizePending(
          pending,
          amountLine.quantity,
          amountLine.unitPrice,
          amountLine.totalAmount,
          [...pending.sourceLines, line],
        );

        if (item) {
          items.push(item);
        }

        pending = undefined;
        continue;
      }

      const singleAmount = this.parseSingleAmountLine(line);

      if (pending && singleAmount !== undefined) {
        pending.amountParts.push(singleAmount);
        pending.sourceLines.push(line);

        if (pending.amountParts.length === 3) {
          const item = this.finalizePending(
            pending,
            pending.amountParts[0],
            pending.amountParts[1],
            pending.amountParts[2],
            pending.sourceLines,
          );

          if (item) {
            items.push(item);
          }

          pending = undefined;
        }

        continue;
      }

      const itemStart = /^(\d{3})(?:\s+(.+))?$/i.exec(line);

      if (itemStart) {
        pending = {
          code: itemStart[1],
          descriptionParts: itemStart[2] ? [itemStart[2]] : [],
          amountParts: [],
          rowIndex,
          pageNumber,
          sourceLines: [line],
        };
        continue;
      }

      if (pending && /[a-z]/i.test(line)) {
        pending.descriptionParts.push(line);
        pending.sourceLines.push(line);
      }
    }

    return items;
  }

  private parseFullLine(line: string, rowIndex: number, pageNumber?: number) {
    const match =
      /^(\d{3})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:,\d+)?)$/i.exec(
        line,
      );

    if (!match) {
      return undefined;
    }

    const quantity = this.parseLocaleNumber(match[3]);
    const unitPrice = this.parseLocaleNumber(match[4]);
    const totalAmount = this.parseLocaleNumber(match[5]);

    if (
      quantity === undefined ||
      unitPrice === undefined ||
      totalAmount === undefined
    ) {
      return undefined;
    }

    return {
      quantity,
      unitPrice,
      totalAmount,
      item: this.buildItem({
        code: match[1],
        descriptionRaw: match[2],
        quantity,
        unitPrice,
        totalAmount,
        rowIndex,
        pageNumber,
        sourceLines: [line],
      }),
    };
  }

  private parseAmountsLine(line: string) {
    const match =
      /^(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(\d{1,3}(?:\.\d{3})*,\d+|\d+(?:,\d+)?)$/i.exec(
        line,
      );

    if (!match) {
      return undefined;
    }

    const quantity = this.parseLocaleNumber(match[1]);
    const unitPrice = this.parseLocaleNumber(match[2]);
    const totalAmount = this.parseLocaleNumber(match[3]);

    if (
      quantity === undefined ||
      unitPrice === undefined ||
      totalAmount === undefined
    ) {
      return undefined;
    }

    return {
      quantity,
      unitPrice,
      totalAmount,
    };
  }

  private parseSingleAmountLine(line: string) {
    if (!/^\d{1,3}(?:\.\d{3})*,\d+$|^\d+(?:,\d+)?$/.test(line.trim())) {
      return undefined;
    }

    return this.parseLocaleNumber(line);
  }

  private finalizePending(
    pending: PendingLine,
    quantity: number,
    unitPrice: number,
    totalAmount: number,
    sourceLines: string[],
  ) {
    const descriptionRaw = pending.descriptionParts.join(' ');

    if (descriptionRaw.length < 3) {
      return undefined;
    }

    return this.buildItem({
      code: pending.code,
      descriptionRaw,
      quantity,
      unitPrice,
      totalAmount,
      rowIndex: pending.rowIndex,
      pageNumber: pending.pageNumber,
      sourceLines,
    });
  }

  private buildItem(input: {
    code: string;
    descriptionRaw: string;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    rowIndex: number;
    pageNumber?: number;
    sourceLines: string[];
  }): ExtractedInvoiceItem {
    const descriptionRaw = input.descriptionRaw.replace(/\s+/g, ' ').trim();
    const warnings = this.validateLineMath(
      input.quantity,
      input.unitPrice,
      input.totalAmount,
    );

    return {
      descriptionRaw,
      descriptionNormalized: this.normalize(descriptionRaw),
      matchCode: this.resolveMatchCode(descriptionRaw),
      reference: input.code,
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
          name: 'soto-invoice',
          code: input.code,
          sourceLines: input.sourceLines,
        },
      },
    };
  }

  private resolveMatchCode(descriptionRaw: string) {
    const normalized = this.normalize(descriptionRaw);

    if (normalized.includes('combo')) {
      return 'SOTO_TROQUELADO_COMBO';
    }

    if (normalized.includes('pizza')) {
      return 'SOTO_TROQUELADO_PIZZA';
    }

    if (normalized.includes('vaso')) {
      return 'SOTO_TROQUELADO_HASTA_52X70';
    }

    const size = /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)/i.exec(
      descriptionRaw,
    );

    if (!size) {
      return 'SOTO_TROQUELADO_HASTA_52X70';
    }

    const first = this.parseLocaleNumber(size[1]);
    const second = this.parseLocaleNumber(size[2]);

    if (first === undefined || second === undefined) {
      return 'SOTO_TROQUELADO_HASTA_52X70';
    }

    const shortSide = Math.min(first, second);
    const longSide = Math.max(first, second);

    return shortSide <= 52 && longSide <= 70
      ? 'SOTO_TROQUELADO_HASTA_52X70'
      : 'SOTO_TROQUELADO_MAS_52X70';
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

  private isEndOfItems(normalizedLine: string) {
    return ['forma de pago', 'base imponible', 'i v a', 'total'].some((term) =>
      normalizedLine.startsWith(term),
    );
  }

  private isNoiseLine(normalizedLine: string) {
    return [
      'codigo concepto tamano',
      'factura num',
      'pagina',
      'fecha',
      'caras',
    ].some((term) => normalizedLine.includes(term));
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
