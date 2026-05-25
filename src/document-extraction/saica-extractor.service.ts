import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class SaicaExtractorService {
  private readonly anonymousSheetQualityMap: Record<string, string> = {
    '18832200000': '1BBM9BB',
    '17032620000': '1SM9D',
  };

  supports(input: DocumentExtractionInput) {
    const supplierName = this.normalize(input.supplierName ?? '');

    return supplierName.includes('saica') || supplierName.includes('saika');
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    const tableItems = this.extractInvoiceFromTables(input.rawData);

    if (tableItems.length > 0) {
      return tableItems;
    }

    return this.extractInvoiceFromText(input.rawText ?? '');
  }

  private extractInvoiceFromTables(
    rawData?: Prisma.JsonValue | null,
  ): ExtractedInvoiceItem[] {
    const items: ExtractedInvoiceItem[] = [];

    for (const table of this.getTables(rawData)) {
      for (const [rowIndex, row] of (table.rows ?? []).entries()) {
        const cells = this.cleanCells(row);
        const normalizedRow = this.normalize(cells.join(' '));

        if (
          cells.length < 6 ||
          this.isNoiseRow(normalizedRow) ||
          !normalizedRow.includes('calidad')
        ) {
          continue;
        }

        const parsed = this.parseFlatText(
          cells.join('\n'),
          rowIndex,
          table.page,
        );

        if (parsed) {
          items.push(parsed);
        }
      }
    }

    return items;
  }

  private extractInvoiceFromText(rawText: string): ExtractedInvoiceItem[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const items: ExtractedInvoiceItem[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      if (!/^Calidad:\s*\d+/i.test(lines[index])) {
        continue;
      }

      const start = Math.max(0, index - 6);
      const end = Math.min(lines.length, index + 6);
      const parsed = this.parseFlatText(
        lines.slice(start, end).join('\n'),
        index,
        1,
      );

      if (parsed) {
        items.push(parsed);
      }
    }

    return items;
  }

  private parseFlatText(
    text: string,
    rowIndex: number,
    pageNumber?: number,
  ): ExtractedInvoiceItem | undefined {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const qualityLine = lines.find((line) => /^Calidad:\s*\d+/i.test(line));
    const qualityMatch = /Calidad:\s*(\d+)/i.exec(qualityLine ?? '');
    const qualityCode = qualityMatch?.[1];
    const channelMatch = /Canal:\s*([A-Z])/i.exec(text);
    const size = lines.find((line) =>
      /^\d+(?:[,.]\d+)?x\d+(?:[,.]\d+)?(?:x\d+(?:[,.]\d+)?)?$/i.test(line),
    );
    const dimensions = this.extractDimensions(size);
    const descriptionRaw = this.extractDescription(lines, qualityLine);
    const numbersBeforeChannel = this.extractNumbersBeforeChannel(lines);

    if (
      !qualityCode ||
      !size ||
      !descriptionRaw ||
      numbersBeforeChannel.length < 3
    ) {
      return undefined;
    }

    const totalAmount = numbersBeforeChannel[0];
    const pricePerThousand = numbersBeforeChannel[1];
    const quantity = numbersBeforeChannel[2];
    const isAnonymousSheet = this.isAnonymousSheet(descriptionRaw);
    const tariffMatchCode = isAnonymousSheet
      ? this.anonymousSheetQualityMap[qualityCode]
      : undefined;
    const matchCode = tariffMatchCode ?? qualityCode;
    const areaM2 = this.calculateAreaM2(dimensions);
    const billableQuantity =
      isAnonymousSheet && areaM2 ? quantity * areaM2 : quantity;
    const unit = isAnonymousSheet && areaM2 ? PriceUnit.M2 : PriceUnit.UNIT;
    const unitPrice =
      isAnonymousSheet && areaM2
        ? totalAmount / billableQuantity
        : pricePerThousand / 1000;

    return {
      descriptionRaw: [descriptionRaw, channelMatch?.[1], size]
        .filter(Boolean)
        .join(' '),
      descriptionNormalized: this.normalize(
        [descriptionRaw, channelMatch?.[1], size].filter(Boolean).join(' '),
      ),
      matchCode,
      channel: channelMatch?.[1],
      lengthMm: dimensions?.lengthMm,
      widthMm: dimensions?.widthMm,
      heightMm: dimensions?.heightMm,
      reference: matchCode,
      size,
      quantity: this.decimalString(billableQuantity, 4),
      unit,
      unitPrice: this.decimalString(unitPrice, 6),
      totalAmount: this.decimalString(totalAmount, 4),
      currency: 'EUR',
      rowIndex,
      pageNumber,
      confidence: 0.94,
      warnings: [],
      rawData: {
        extractor: {
          name: 'saica-invoice',
          text,
          qualityCode,
          pricePerThousand: this.decimalString(pricePerThousand, 4),
          originalQuantity: this.decimalString(quantity, 4),
          areaM2: areaM2 ? this.decimalString(areaM2, 6) : undefined,
          mappedTariffMatchCode: tariffMatchCode,
        },
      },
    };
  }

  private isAnonymousSheet(descriptionRaw: string) {
    return this.normalize(descriptionRaw).includes('plancha anonima');
  }

  private calculateAreaM2(dimensions?: {
    lengthMm: string;
    widthMm: string;
    heightMm?: string;
  }) {
    if (!dimensions) {
      return undefined;
    }

    const lengthMm = Number(dimensions.lengthMm);
    const widthMm = Number(dimensions.widthMm);

    if (!Number.isFinite(lengthMm) || !Number.isFinite(widthMm)) {
      return undefined;
    }

    return (lengthMm * widthMm) / 1_000_000;
  }

  private extractNumbersBeforeChannel(lines: string[]) {
    const values: number[] = [];

    for (const line of lines) {
      if (/^Canal:/i.test(line)) {
        break;
      }

      const amount = this.parseLocaleNumber(line);

      if (amount !== undefined) {
        values.push(amount);
      }
    }

    return values;
  }

  private extractDescription(lines: string[], qualityLine?: string) {
    const qualityIndex = qualityLine ? lines.indexOf(qualityLine) : -1;

    if (qualityIndex < 0) {
      return undefined;
    }

    return lines
      .slice(qualityIndex + 1)
      .filter(
        (line) =>
          !/^S\/ORD:/i.test(line) &&
          !/^ALB\//i.test(line) &&
          !/^\d{5,}$/.test(line) &&
          !/^No$/i.test(line),
      )
      .find((line) => /[a-z]/i.test(line));
  }

  private extractDimensions(value?: string) {
    const match =
      /^(\d+(?:[,.]\d+)?)x(\d+(?:[,.]\d+)?)(?:x(\d+(?:[,.]\d+)?))?$/i.exec(
        value ?? '',
      );

    if (!match) {
      return undefined;
    }

    return {
      lengthMm: this.decimalString(this.parseLocaleNumber(match[1]) ?? 0, 4),
      widthMm: this.decimalString(this.parseLocaleNumber(match[2]) ?? 0, 4),
      heightMm:
        match[3] === undefined
          ? undefined
          : this.decimalString(this.parseLocaleNumber(match[3]) ?? 0, 4),
    };
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

  private isNoiseRow(normalizedRow: string) {
    return [
      'n factura',
      'fecha emision',
      'cliente',
      'total lineas',
      'suma importes',
      'forma de pago',
      'base imponible',
      'total factura',
    ].some((term) => normalizedRow.includes(term));
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
