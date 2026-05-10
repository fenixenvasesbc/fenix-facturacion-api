import { Injectable, Logger } from '@nestjs/common';
import {
  InvoiceItemValidationStatus,
  PriceItemStatus,
  PriceUnit,
  Prisma,
} from '@prisma/client';
import { ParsedInvoiceItem } from './invoice-parser.service';

export interface InvoiceDifference {
  product: string;
  negotiatedPrice: string | null;
  invoicedPrice: string;
  differencePercent: string | null;
  status: InvoiceItemValidationStatus;
}

export interface InvoiceValidationResponse {
  status: 'OK' | 'DIFFERENCES_FOUND';
  message: string;
  differences: InvoiceDifference[];
}

type NegotiatedItem = Prisma.PriceListItemGetPayload<{
  include: {
    canonicalProduct: true;
    aliases: true;
  };
}>;

@Injectable()
export class InvoiceValidationService {
  private readonly logger = new Logger(InvoiceValidationService.name);
  private readonly tolerancePercent = 0.01;

  validate(
    invoiceItems: ParsedInvoiceItem[],
    negotiatedItems: NegotiatedItem[],
  ) {
    this.logger.log(
      `Validating invoice items. itemCount=${invoiceItems.length} negotiatedCount=${negotiatedItems.length}`,
    );

    const validatedItems = invoiceItems.map((invoiceItem) => {
      const match = this.findBestMatch(invoiceItem, negotiatedItems);

      if (!match) {
        return {
          invoiceItem,
          matchedItem: undefined,
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
          differencePercent: undefined,
        };
      }

      if (!this.unitsAreCompatible(invoiceItem.unit, match)) {
        return {
          invoiceItem,
          matchedItem: match,
          validationStatus: InvoiceItemValidationStatus.UNIDAD_INCOMPATIBLE,
          differencePercent: undefined,
        };
      }

      const negotiatedPrice = this.getNegotiatedUnitPrice(match);
      const invoicedPrice = Number(invoiceItem.unitPrice);
      const differencePercent =
        ((invoicedPrice - negotiatedPrice) / negotiatedPrice) * 100;
      const validationStatus = this.resolveStatus(differencePercent);

      return {
        invoiceItem,
        matchedItem: match,
        validationStatus,
        differencePercent,
      };
    });

    const differences = validatedItems
      .filter(
        (item) => item.validationStatus !== InvoiceItemValidationStatus.OK,
      )
      .map((item) => this.toDifference(item));

    const response: InvoiceValidationResponse =
      differences.length === 0
        ? {
            status: 'OK',
            message:
              'Todos los productos fueron cobrados correctamente según los precios negociados.',
            differences: [],
          }
        : {
            status: 'DIFFERENCES_FOUND',
            message:
              'Se encontraron diferencias entre la factura y los precios negociados.',
            differences,
          };

    return {
      response,
      items: validatedItems,
    };
  }

  private findBestMatch(
    invoiceItem: ParsedInvoiceItem,
    negotiatedItems: NegotiatedItem[],
  ) {
    const activeItems = negotiatedItems.filter(
      (item) => item.status === PriceItemStatus.ACTIVE,
    );
    let bestMatch: NegotiatedItem | undefined;
    let bestScore = 0;

    for (const item of activeItems) {
      const score = this.matchScore(invoiceItem.descriptionNormalized, item);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    return bestScore >= 0.55 ? bestMatch : undefined;
  }

  private matchScore(description: string, item: NegotiatedItem) {
    const candidates = [
      item.descriptionNormalized,
      item.descriptionRaw,
      item.canonicalProduct?.name,
      ...item.aliases.map((alias) => alias.aliasNormalized ?? alias.aliasRaw),
    ]
      .filter(Boolean)
      .map((value) => this.normalize(String(value)));

    return Math.max(
      ...candidates.map((candidate) =>
        this.tokenSimilarity(description, candidate),
      ),
      0,
    );
  }

  private tokenSimilarity(left: string, right: string) {
    if (left.includes(right) || right.includes(left)) {
      return 0.9;
    }

    const leftTokens = new Set(left.split(' ').filter(Boolean));
    const rightTokens = new Set(right.split(' ').filter(Boolean));

    if (leftTokens.size === 0 || rightTokens.size === 0) {
      return 0;
    }

    const intersection = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    );
    const union = new Set([...leftTokens, ...rightTokens]);

    return intersection.length / union.size;
  }

  private unitsAreCompatible(
    invoiceUnit: PriceUnit,
    negotiatedItem: NegotiatedItem,
  ) {
    const negotiatedUnit =
      negotiatedItem.normalizedUnit ??
      negotiatedItem.priceUnit ??
      PriceUnit.UNKNOWN;

    if (
      invoiceUnit === PriceUnit.UNKNOWN ||
      negotiatedUnit === PriceUnit.UNKNOWN
    ) {
      return true;
    }

    return invoiceUnit === negotiatedUnit;
  }

  private getNegotiatedUnitPrice(item: NegotiatedItem) {
    const normalizedUnitPrice = item.normalizedUnitPrice?.toString();

    if (normalizedUnitPrice) {
      return Number(normalizedUnitPrice);
    }

    return (
      Number(item.priceAmount.toString()) /
      Number(item.priceQuantityBase.toString())
    );
  }

  private resolveStatus(differencePercent: number) {
    if (Math.abs(differencePercent) <= this.tolerancePercent) {
      return InvoiceItemValidationStatus.OK;
    }

    if (differencePercent > 0) {
      return InvoiceItemValidationStatus.SOBRECOSTE;
    }

    return InvoiceItemValidationStatus.PRECIO_MENOR;
  }

  private toDifference(item: {
    invoiceItem: ParsedInvoiceItem;
    matchedItem?: NegotiatedItem;
    validationStatus: InvoiceItemValidationStatus;
    differencePercent?: number;
  }): InvoiceDifference {
    return {
      product: item.invoiceItem.descriptionRaw,
      negotiatedPrice: item.matchedItem
        ? `${this.decimalString(this.getNegotiatedUnitPrice(item.matchedItem), 6)} €/ ${this.unitLabel(item.matchedItem.normalizedUnit ?? item.matchedItem.priceUnit)}`
        : null,
      invoicedPrice: `${item.invoiceItem.unitPrice} €/ ${this.unitLabel(item.invoiceItem.unit)}`,
      differencePercent:
        item.differencePercent === undefined
          ? null
          : `${item.differencePercent >= 0 ? '+' : ''}${this.decimalString(item.differencePercent, 2)}%`,
      status: item.validationStatus,
    };
  }

  private unitLabel(unit: PriceUnit) {
    const labels: Record<PriceUnit, string> = {
      UNIT: 'ud',
      THOUSAND_UNITS: 'millar',
      M2: 'm2',
      ML: 'ml',
      KG: 'kg',
      TON: 'ton',
      BOX: 'caja',
      PACK: 'pack',
      PALLET: 'pallet',
      SERVICE: 'servicio',
      UNKNOWN: 'unidad desconocida',
    };

    return labels[unit];
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
