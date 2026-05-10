import { Injectable, Logger } from '@nestjs/common';
import { PriceItemStatus, PriceUnit, Prisma } from '@prisma/client';

export interface ParsePriceListInput {
  rawText?: string | null;
  rawData?: Prisma.JsonValue | null;
}

export interface ParsedPriceListItem {
  descriptionRaw: string;
  descriptionNormalized: string;
  channel?: string;
  priceAmount: string;
  currency: string;
  priceUnit: PriceUnit;
  priceQuantityBase: string;
  rawUnitLabel?: string;
  normalizedUnitPrice?: string;
  normalizedUnit?: PriceUnit;
  discountPercent?: string;
  taxPercent?: string;
  status: PriceItemStatus;
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
  priceUnitHint?: PriceUnit;
}

@Injectable()
export class PriceListParserService {
  private readonly logger = new Logger(PriceListParserService.name);

  parse(input: ParsePriceListInput): ParsedPriceListItem[] {
    const candidates = this.buildCandidates(input);
    const items = candidates
      .map((candidate) => this.parseCandidate(candidate))
      .filter((item): item is ParsedPriceListItem => Boolean(item));

    this.logger.log(`Parsed price list items. count=${items.length}`);

    return items;
  }

  private buildCandidates(input: ParsePriceListInput): CandidateRow[] {
    const tableCandidates = this.extractTableCandidates(input.rawData);

    if (tableCandidates.length > 0) {
      return tableCandidates;
    }

    return (input.rawText ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
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

    const tables = raw?.ocr?.tables ?? [];
    const candidates: CandidateRow[] = [];

    for (const table of tables) {
      let priceUnitHint: PriceUnit | undefined;

      for (const [rowIndex, row] of (table.rows ?? []).entries()) {
        const cells = row.map((cell) => String(cell).trim()).filter(Boolean);

        if (cells.length === 0) {
          continue;
        }

        const normalizedRow = this.normalizeDescription(cells.join(' '));

        if (normalizedRow.includes('precio millar')) {
          priceUnitHint = PriceUnit.THOUSAND_UNITS;
          continue;
        }

        candidates.push({
          text: cells.join(' '),
          rowIndex,
          pageNumber: table.page,
          source: 'ocr-table',
          cells,
          priceUnitHint,
        });
      }
    }

    return candidates;
  }

  private parseCandidate(
    candidate: CandidateRow,
  ): ParsedPriceListItem | undefined {
    if (!this.looksLikePriceRow(candidate.text)) {
      return undefined;
    }

    const price = this.extractPrice(candidate.text);

    if (!price) {
      return undefined;
    }

    const unit = this.extractUnit(candidate.text, candidate.priceUnitHint);
    const discountPercent = this.extractPercent(candidate.text, 'discount');
    const taxPercent = this.extractPercent(candidate.text, 'tax');
    const channel = this.extractChannel(candidate.text);
    const descriptionRaw = this.extractDescription(candidate.text, price.raw);

    if (descriptionRaw.length < 3) {
      return undefined;
    }

    const normalizedUnitPrice = this.normalizeUnitPrice(price.amount, unit);
    const status =
      unit.priceUnit === PriceUnit.UNKNOWN
        ? PriceItemStatus.NEEDS_REVIEW
        : PriceItemStatus.ACTIVE;

    return {
      descriptionRaw,
      descriptionNormalized: this.normalizeDescription(descriptionRaw),
      channel,
      priceAmount: this.decimalString(price.amount, 4),
      currency: price.currency,
      priceUnit: unit.priceUnit,
      priceQuantityBase: this.decimalString(unit.quantityBase, 4),
      rawUnitLabel: unit.rawUnitLabel,
      normalizedUnitPrice:
        normalizedUnitPrice === undefined
          ? undefined
          : this.decimalString(normalizedUnitPrice, 6),
      normalizedUnit: unit.normalizedUnit,
      discountPercent:
        discountPercent === undefined
          ? undefined
          : this.decimalString(discountPercent, 4),
      taxPercent:
        taxPercent === undefined
          ? undefined
          : this.decimalString(taxPercent, 4),
      status,
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

  private looksLikePriceRow(text: string) {
    return /\d/.test(text) && /(?:€|eur|\b\d+[,.]\d{2,4}\b)/i.test(text);
  }

  private extractPrice(text: string) {
    const matches = [
      ...text.matchAll(
        /(?:(€|eur)\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,4})|\d+(?:[,.]\d{1,4})?)(?:\s*(€|eur))?/gi,
      ),
    ];

    const priceMatches = matches
      .map((match) => ({
        raw: match[0],
        amount: this.parseNumber(match[2]),
        currency: match[1] || match[3] ? 'EUR' : 'EUR',
        hasCurrency: Boolean(match[1] || match[3]),
        isPercent: this.isPercentMatch(text, match),
      }))
      .filter((match) => match.amount > 0 && !match.isPercent);

    return (
      priceMatches.filter((match) => match.hasCurrency).at(-1) ??
      priceMatches.at(-1)
    );
  }

  private isPercentMatch(text: string, match: RegExpMatchArray) {
    const index = match.index ?? 0;
    const after = text.slice(index + match[0].length).trimStart();

    return after.startsWith('%');
  }

  private extractUnit(text: string, priceUnitHint?: PriceUnit) {
    const normalized = this.normalizeDescription(text);
    const mappings: Array<{
      pattern: RegExp;
      priceUnit: PriceUnit;
      quantityBase: number;
      normalizedUnit: PriceUnit;
      rawUnitLabel: string;
    }> = [
      {
        pattern: /\b(millar|mil|1000|thousand)\b/i,
        priceUnit: PriceUnit.THOUSAND_UNITS,
        quantityBase: 1000,
        normalizedUnit: PriceUnit.UNIT,
        rawUnitLabel: 'millar',
      },
      {
        pattern: /\b(m2|m²|metro cuadrado|metros cuadrados)\b/i,
        priceUnit: PriceUnit.M2,
        quantityBase: 1,
        normalizedUnit: PriceUnit.M2,
        rawUnitLabel: 'm2',
      },
      {
        pattern: /\b(ml|metro lineal|metros lineales)\b/i,
        priceUnit: PriceUnit.ML,
        quantityBase: 1,
        normalizedUnit: PriceUnit.ML,
        rawUnitLabel: 'ml',
      },
      {
        pattern: /\b(kg|kilo|kilogramo|kilogramos)\b/i,
        priceUnit: PriceUnit.KG,
        quantityBase: 1,
        normalizedUnit: PriceUnit.KG,
        rawUnitLabel: 'kg',
      },
      {
        pattern: /\b(ton|tn|tonelada|toneladas)\b/i,
        priceUnit: PriceUnit.TON,
        quantityBase: 1,
        normalizedUnit: PriceUnit.TON,
        rawUnitLabel: 'ton',
      },
      {
        pattern: /\b(caja|box)\b/i,
        priceUnit: PriceUnit.BOX,
        quantityBase: 1,
        normalizedUnit: PriceUnit.BOX,
        rawUnitLabel: 'caja',
      },
      {
        pattern: /\b(pack|paquete)\b/i,
        priceUnit: PriceUnit.PACK,
        quantityBase: 1,
        normalizedUnit: PriceUnit.PACK,
        rawUnitLabel: 'pack',
      },
      {
        pattern: /\b(pallet|palet)\b/i,
        priceUnit: PriceUnit.PALLET,
        quantityBase: 1,
        normalizedUnit: PriceUnit.PALLET,
        rawUnitLabel: 'pallet',
      },
      {
        pattern: /\b(servicio|service)\b/i,
        priceUnit: PriceUnit.SERVICE,
        quantityBase: 1,
        normalizedUnit: PriceUnit.SERVICE,
        rawUnitLabel: 'servicio',
      },
      {
        pattern: /\b(ud|uds|unidad|unidades|unit)\b/i,
        priceUnit: PriceUnit.UNIT,
        quantityBase: 1,
        normalizedUnit: PriceUnit.UNIT,
        rawUnitLabel: 'unidad',
      },
    ];

    const mapping = mappings.find((entry) => entry.pattern.test(normalized));

    if (mapping) {
      return mapping;
    }

    if (priceUnitHint === PriceUnit.THOUSAND_UNITS) {
      return {
        priceUnit: PriceUnit.THOUSAND_UNITS,
        quantityBase: 1000,
        normalizedUnit: PriceUnit.M2,
        rawUnitLabel: 'millar',
      };
    }

    return {
      priceUnit: PriceUnit.UNKNOWN,
      quantityBase: 1,
      normalizedUnit: PriceUnit.UNKNOWN,
      rawUnitLabel: undefined,
    };
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

    return this.parseNumber(match[1] ?? match[2]);
  }

  private extractChannel(text: string) {
    const normalized = this.normalizeDescription(text);
    const channels = [
      'web',
      'tienda',
      'almacen',
      'obra',
      'profesional',
      'retail',
    ];

    return channels.find((channel) => normalized.includes(channel));
  }

  private extractDescription(text: string, rawPrice: string) {
    return text
      .replace(rawPrice, ' ')
      .replace(/(?:€|eur)/gi, ' ')
      .replace(/(?:dto|desc|descuento|iva|tax)\.?\s*\d+(?:[,.]\d+)?\s*%/gi, ' ')
      .replace(
        /\b(?:por|\/)\s*(?:millar|mil|m2|m²|ml|kg|ton|tn|caja|box|pack|paquete|pallet|palet|ud|uds|unidad|unidades)\b/gi,
        ' ',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private normalizeUnitPrice(amount: number, unit: { quantityBase: number }) {
    if (!Number.isFinite(amount) || unit.quantityBase <= 0) {
      return undefined;
    }

    return amount / unit.quantityBase;
  }

  private parseNumber(value: string) {
    const clean = value.replace(/\s/g, '');

    if (clean.includes(',') && clean.includes('.')) {
      return Number(clean.replace(/\./g, '').replace(',', '.'));
    }

    return Number(clean.replace(',', '.'));
  }

  private decimalString(value: number, fractionDigits: number) {
    return value.toFixed(fractionDigits);
  }

  private normalizeDescription(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
