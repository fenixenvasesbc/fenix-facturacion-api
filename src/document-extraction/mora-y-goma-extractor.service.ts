import { Injectable } from '@nestjs/common';
import { PriceUnit, Prisma } from '@prisma/client';
import {
  DocumentExtractionInput,
  ExtractedInvoiceItem,
  ExtractedPriceListItem,
  OcrTable,
} from './document-extraction.types';

@Injectable()
export class MoraYGomaExtractorService {
  supports(input: DocumentExtractionInput) {
    return this.normalize(input.supplierName ?? '').includes('mora y goma');
  }

  extractPriceList(input: DocumentExtractionInput): ExtractedPriceListItem[] {
    const items: ExtractedPriceListItem[] = [];

    for (const table of this.getTables(input.rawData)) {
      let insidePriceTable = false;

      for (const [rowIndex, row] of (table.rows ?? []).entries()) {
        const cells = this.cleanCells(row);
        const normalizedRow = this.normalize(cells.join(' '));

        if (
          normalizedRow.includes('descripcion') &&
          normalizedRow.includes('precio millar')
        ) {
          insidePriceTable = true;
          continue;
        }

        if (!insidePriceTable || cells.length < 2 || this.isNoiseRow(cells)) {
          continue;
        }

        const priceCell = cells.at(-1);
        const priceAmount = priceCell
          ? this.parseLocaleNumber(priceCell)
          : undefined;

        if (priceAmount === undefined || priceAmount <= 0) {
          continue;
        }

        const channel = this.extractChannel(cells);
        const descriptionRaw = this.extractPriceListDescription(cells);

        if (!descriptionRaw) {
          continue;
        }

        items.push({
          descriptionRaw,
          descriptionNormalized: this.normalize(descriptionRaw),
          channel,
          priceAmount: this.decimalString(priceAmount, 4),
          currency: 'EUR',
          priceUnit: PriceUnit.THOUSAND_UNITS,
          priceQuantityBase: '1000.0000',
          rawUnitLabel: 'millar',
          normalizedUnitPrice: this.decimalString(priceAmount / 1000, 6),
          normalizedUnit: PriceUnit.M2,
          rowIndex,
          pageNumber: table.page,
          confidence: 0.95,
          warnings: [],
          rawData: {
            extractor: {
              name: 'mora-y-goma-price-list',
              cells,
            },
          },
        });
      }
    }

    return items;
  }

  extractInvoice(input: DocumentExtractionInput): ExtractedInvoiceItem[] {
    const items: ExtractedInvoiceItem[] = [];

    for (const table of this.getTables(input.rawData)) {
      let insideInvoiceTable = false;

      for (const [rowIndex, row] of (table.rows ?? []).entries()) {
        const cells = this.cleanCells(row);
        const normalizedRow = this.normalize(cells.join(' '));

        if (
          normalizedRow.includes('hojas rollos') &&
          normalizedRow.includes('precio') &&
          normalizedRow.includes('importe')
        ) {
          insideInvoiceTable = true;
          continue;
        }

        if (
          !insideInvoiceTable ||
          cells.length < 7 ||
          this.isSummaryRow(cells)
        ) {
          continue;
        }

        const totalAmount = this.parseLocaleNumber(cells.at(-1) ?? '');
        const unitPrice = this.parseLocaleNumber(cells.at(-2) ?? '');
        const billableQuantity = this.parseLocaleNumber(cells.at(-3) ?? '');

        if (unitPrice === undefined || totalAmount === undefined) {
          continue;
        }

        const productCells = cells.slice(0, -3);
        const reference = productCells[0];
        const size = productCells.find((cell) =>
          /\d+[,.]\d+\*\d+[,.]\d+/.test(cell),
        );
        const channel = this.extractChannel(productCells);
        const description = this.extractInvoiceDescription(productCells);
        const warnings = this.validateLineMath(
          billableQuantity,
          unitPrice,
          totalAmount,
        );

        if (!description) {
          continue;
        }

        items.push({
          descriptionRaw: [description, channel, size]
            .filter(Boolean)
            .join(' '),
          descriptionNormalized: this.normalize(
            [description, channel, size].filter(Boolean).join(' '),
          ),
          reference,
          size,
          channel,
          quantity:
            billableQuantity === undefined
              ? undefined
              : this.decimalString(billableQuantity, 4),
          unit: PriceUnit.M2,
          unitPrice: this.decimalString(unitPrice, 6),
          totalAmount: this.decimalString(totalAmount, 4),
          currency: 'EUR',
          rowIndex,
          pageNumber: table.page,
          confidence: warnings.length === 0 ? 0.96 : 0.82,
          warnings,
          rawData: {
            extractor: {
              name: 'mora-y-goma-invoice',
              cells,
            },
          },
        });
      }
    }

    return items;
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

  private isNoiseRow(cells: string[]) {
    const normalized = this.normalize(cells.join(' '));

    return [
      'pagina',
      'fecha',
      'cliente',
      'contacto',
      'condiciones',
      'diaspagofijo',
      'dtos',
      'rappel',
      'partidas',
      'servicios',
      'cargo',
    ].some((term) => normalized.includes(term));
  }

  private isSummaryRow(cells: string[]) {
    const normalized = this.normalize(cells.join(' '));

    return [
      'suma importes',
      'base imponible',
      'total factura',
      'forma de pago',
      'importes',
      'swift',
      'vtos',
      'todos los productos',
      'albaran',
    ].some((term) => normalized.includes(term));
  }

  private extractChannel(cells: string[]) {
    const knownChannels = new Set(['E', 'B', 'C', 'R']);

    return cells.find((cell) => knownChannels.has(cell.trim().toUpperCase()));
  }

  private extractPriceListDescription(cells: string[]) {
    const withoutPrice = cells.slice(0, -1);
    const channel = this.extractChannel(withoutPrice);
    const description = withoutPrice
      .filter((cell) => cell !== channel)
      .join(' ')
      .trim();

    return description.length >= 3 ? description : undefined;
  }

  private extractInvoiceDescription(cells: string[]) {
    return cells.find((cell) =>
      /BICO|KRAFT|BLANCO|ESTUCADO|K-C|C-C|BB-BB|KB-C/i.test(cell),
    );
  }

  private validateLineMath(
    quantity: number | undefined,
    unitPrice: number,
    totalAmount: number,
  ) {
    if (quantity === undefined) {
      return ['No se detectó cantidad facturable'];
    }

    const expected = quantity * unitPrice;
    const difference = Math.abs(expected - totalAmount);

    if (difference > 0.05) {
      return [
        `Importe no cuadra: ${this.decimalString(quantity, 4)} * ${this.decimalString(unitPrice, 6)} = ${this.decimalString(expected, 2)} vs ${this.decimalString(totalAmount, 2)}`,
      ];
    }

    return [];
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
