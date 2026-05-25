import { Injectable, Logger } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';

export interface ParsedInvoiceItem {
  descriptionRaw: string;
  descriptionNormalized: string;
  matchCode?: string;
  channel?: string;
  lengthMm?: string;
  widthMm?: string;
  heightMm?: string;
  quantity?: string;
  unit: PriceUnit;
  unitPrice: string;
  totalAmount?: string;
  currency: string;
  discountPercent?: string;
  taxPercent?: string;
  rowIndex: number;
  pageNumber?: number;
  rawData: Prisma.InputJsonObject;
}

interface CandidateRow {
  text: string;
  rowIndex: number;
  pageNumber?: number;
  source: 'ocr-table' | 'raw-text';
  cells?: string[];
}

@Injectable()
export class InvoiceParserService {
  private readonly logger = new Logger(InvoiceParserService.name);

  parse(input: {
    rawText?: string | null;
    rawData?: Prisma.JsonValue | null;
  }): ParsedInvoiceItem[] {
    const candidates = this.buildCandidates(input);
    const items = candidates
      .map((candidate) => this.parseCandidate(candidate))
      .filter((item): item is ParsedInvoiceItem => Boolean(item));

    this.logger.log(`Parsed invoice items. count=${items.length}`);

    return items;
  }

  private buildCandidates(input: {
    rawText?: string | null;
    rawData?: Prisma.JsonValue | null;
  }) {
    const tableCandidates = this.extractTableCandidates(input.rawData);

    if (tableCandidates.length > 0) {
      return tableCandidates;
    }

    return (input.rawText ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => ({
        text: line,
        rowIndex: index,
        source: 'raw-text' as const,
      }));
  }

  private extractTableCandidates(rawData?: Prisma.JsonValue | null) {
    const raw = rawData as
      | {
          ocr?: {
            tables?: Array<{
              page?: number;
              rows?: string[][];
            }>;
          };
        }
      | null
      | undefined;
    const candidates: CandidateRow[] = [];

    for (const table of raw?.ocr?.tables ?? []) {
      for (const [rowIndex, row] of (table.rows ?? []).entries()) {
        const cells = row.map((cell) => String(cell).trim()).filter(Boolean);

        if (cells.length === 0) {
          continue;
        }

        candidates.push({
          text: cells.join(' '),
          rowIndex,
          pageNumber: table.page,
          source: 'ocr-table',
          cells,
        });
      }
    }

    return candidates;
  }

  private parseCandidate(
    candidate: CandidateRow,
  ): ParsedInvoiceItem | undefined {
    const tableItem = this.parseTableCandidate(candidate);

    if (tableItem) {
      return tableItem;
    }

    if (!this.looksLikeInvoiceRow(candidate.text)) {
      return undefined;
    }

    const numbers = this.extractNumbers(candidate.text);

    if (numbers.length === 0) {
      return undefined;
    }

    const total = numbers.at(-1);
    const unitPrice = numbers.length >= 2 ? numbers.at(-2) : total;
    const quantity = this.extractQuantity(candidate.text, numbers);
    const unit = this.extractUnit(candidate.text);
    const descriptionRaw = this.extractDescription(candidate.text, [
      total?.raw,
      unitPrice?.raw,
      quantity?.raw,
    ]);

    if (!unitPrice || descriptionRaw.length < 3) {
      return undefined;
    }

    return {
      descriptionRaw,
      descriptionNormalized: this.normalizeText(descriptionRaw),
      quantity: quantity ? this.decimalString(quantity.amount, 4) : undefined,
      unit,
      unitPrice: this.decimalString(unitPrice.amount, 6),
      totalAmount: total ? this.decimalString(total.amount, 4) : undefined,
      currency: 'EUR',
      discountPercent: this.extractPercent(candidate.text, 'discount'),
      taxPercent: this.extractPercent(candidate.text, 'tax'),
      rowIndex: candidate.rowIndex,
      pageNumber: candidate.pageNumber,
      rawData: {
        parser: {
          source: candidate.source,
          text: candidate.text,
          cells: candidate.cells ?? [],
        },
      },
    };
  }

  private parseTableCandidate(
    candidate: CandidateRow,
  ): ParsedInvoiceItem | undefined {
    const cells = candidate.cells ?? [];

    if (candidate.source !== 'ocr-table' || cells.length < 7) {
      return undefined;
    }

    if (this.isSummaryOrHeaderRow(cells)) {
      return undefined;
    }

    const amountCell = cells.at(-1);
    const priceCell = cells.at(-2);
    const m2OrKgCell = cells.at(-3);

    if (!amountCell || !priceCell || !m2OrKgCell) {
      return undefined;
    }

    const amount = this.parseNumberSafe(amountCell);
    const unitPrice = this.parseNumberSafe(priceCell);
    const quantity = this.parseNumberSafe(m2OrKgCell);

    if (amount === undefined || unitPrice === undefined) {
      return undefined;
    }

    const productCells = cells.slice(0, -3);
    const { descriptionRaw, channel } =
      this.extractStructuredDescription(productCells);

    if (!descriptionRaw) {
      return undefined;
    }

    return {
      descriptionRaw,
      descriptionNormalized: this.normalizeText(descriptionRaw),
      quantity:
        quantity === undefined ? undefined : this.decimalString(quantity, 4),
      unit: PriceUnit.M2,
      unitPrice: this.decimalString(unitPrice, 6),
      totalAmount: this.decimalString(amount, 4),
      currency: 'EUR',
      rowIndex: candidate.rowIndex,
      pageNumber: candidate.pageNumber,
      rawData: {
        parser: {
          source: candidate.source,
          text: candidate.text,
          cells,
          channel,
        },
      },
    };
  }

  private isSummaryOrHeaderRow(cells: string[]) {
    const normalized = this.normalizeText(cells.join(' '));

    return [
      'suma importes',
      'base imponible',
      'total factura',
      'forma de pago',
      'importes',
      'descripcion canal',
      'hojas rollos',
    ].some((term) => normalized.includes(term));
  }

  private extractStructuredDescription(cells: string[]) {
    const productLikeCells = cells.filter((cell) => /[a-z]/i.test(cell));
    const knownChannels = new Set(['E', 'B', 'C', 'R']);
    const channel = productLikeCells.find((cell) =>
      knownChannels.has(cell.trim().toUpperCase()),
    );
    const descriptionCell =
      productLikeCells.find((cell) =>
        /-|BICO|KRAFT|BLANCO|ESTUCADO/i.test(cell),
      ) ?? productLikeCells.at(-1);
    const sizeCell = cells.find((cell) => /\d+[,.]\d+\*\d+[,.]\d+/.test(cell));
    const descriptionRaw = [descriptionCell, channel, sizeCell]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      descriptionRaw,
      channel,
    };
  }

  private looksLikeInvoiceRow(text: string) {
    return /\d/.test(text) && /(?:€|eur|\b\d+[,.]\d{2,6}\b)/i.test(text);
  }

  private extractNumbers(text: string) {
    return [
      ...text.matchAll(
        /(?:(€|eur)\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,6})|\d+(?:[,.]\d{1,6})?)(?:\s*(€|eur))?/gi,
      ),
    ]
      .map((match) => ({
        raw: match[0],
        amount: this.parseNumber(match[2]),
        index: match.index ?? 0,
        isPercent: this.isPercentMatch(text, match),
      }))
      .filter((match) => match.amount > 0 && !match.isPercent);
  }

  private extractQuantity(
    text: string,
    numbers: Array<{ raw: string; amount: number; index: number }>,
  ) {
    const unitPattern =
      /\b(\d+(?:[,.]\d+)?)\s*(ud|uds|unidad|unidades|m2|m²|ml|kg|ton|tn|caja|pack|pallet|palet)\b/i;
    const match = unitPattern.exec(text);

    if (match) {
      return {
        raw: match[1],
        amount: this.parseNumber(match[1]),
      };
    }

    if (numbers.length >= 3) {
      return numbers[0];
    }

    return undefined;
  }

  private extractUnit(text: string) {
    const normalized = this.normalizeText(text);

    if (/\b(m2|m²|metro cuadrado|metros cuadrados)\b/i.test(normalized)) {
      return PriceUnit.M2;
    }

    if (/\b(ml|metro lineal|metros lineales)\b/i.test(normalized)) {
      return PriceUnit.ML;
    }

    if (/\b(kg|kilo|kilogramo|kilogramos)\b/i.test(normalized)) {
      return PriceUnit.KG;
    }

    if (/\b(ton|tn|tonelada|toneladas)\b/i.test(normalized)) {
      return PriceUnit.TON;
    }

    if (/\b(caja|box)\b/i.test(normalized)) {
      return PriceUnit.BOX;
    }

    if (/\b(pack|paquete)\b/i.test(normalized)) {
      return PriceUnit.PACK;
    }

    if (/\b(pallet|palet)\b/i.test(normalized)) {
      return PriceUnit.PALLET;
    }

    if (/\b(ud|uds|unidad|unidades|unit)\b/i.test(normalized)) {
      return PriceUnit.UNIT;
    }

    return PriceUnit.UNKNOWN;
  }

  private extractPercent(text: string, kind: 'discount' | 'tax') {
    const pattern =
      kind === 'discount'
        ? /(?:dto|desc|descuento)\.?\s*(\d+(?:[,.]\d+)?)\s*%|(\d+(?:[,.]\d+)?)\s*%\s*(?:dto|desc|descuento)/i
        : /(?:iva|tax)\s*(\d+(?:[,.]\d+)?)\s*%|(\d+(?:[,.]\d+)?)\s*%\s*(?:iva|tax)/i;
    const match = pattern.exec(text);

    if (!match) {
      return undefined;
    }

    return this.decimalString(this.parseNumber(match[1] ?? match[2]), 4);
  }

  private extractDescription(
    text: string,
    removable: Array<string | undefined>,
  ) {
    let description = text;

    for (const value of removable.filter(Boolean)) {
      description = description.replace(value as string, ' ');
    }

    return description
      .replace(/(?:€|eur)/gi, ' ')
      .replace(/(?:dto|desc|descuento|iva|tax)\.?\s*\d+(?:[,.]\d+)?\s*%/gi, ' ')
      .replace(
        /\b(?:ud|uds|unidad|unidades|m2|m²|ml|kg|ton|tn|caja|box|pack|paquete|pallet|palet)\b/gi,
        ' ',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private isPercentMatch(text: string, match: RegExpMatchArray) {
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length).trimStart();

    return after.startsWith('%');
  }

  private parseNumber(value: string) {
    const clean = value.replace(/\s/g, '');

    if (clean.includes(',') && clean.includes('.')) {
      return Number(clean.replace(/\./g, '').replace(',', '.'));
    }

    return Number(clean.replace(',', '.'));
  }

  private parseNumberSafe(value: string) {
    if (
      !/^-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^-?\d+(?:[,.]\d+)?$/.test(value)
    ) {
      return undefined;
    }

    return this.parseNumber(value);
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private normalizeText(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
