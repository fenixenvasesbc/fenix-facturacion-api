import { Injectable, Logger } from '@nestjs/common';
import {
  InvoiceBillingResult,
  InvoiceItemValidationStatus,
  PriceItemStatus,
  PriceUnit,
  Prisma,
} from '@prisma/client';
import { ParsedInvoiceItem } from './invoice-parser.service';

export type InvoiceDifferenceSeverity = 'CRITICAL' | 'REVIEW' | 'INFO';

export interface InvoiceValidationSummary {
  totalItems: number;
  ok: number;
  overcharges: number;
  undercharges: number;
  notFound: number;
  unitMismatches: number;
  requiresReview: number;
}

export interface InvoiceDifference {
  product: string;
  negotiatedPrice: string | null;
  invoicedPrice: string;
  differencePercent: string | null;
  status: InvoiceItemValidationStatus;
  severity: InvoiceDifferenceSeverity;
}

export interface InvoiceValidationResponse {
  status: 'OK' | 'DIFFERENCES_FOUND';
  billingResult: InvoiceBillingResult;
  message: string;
  summary: InvoiceValidationSummary;
  differences: InvoiceDifference[];
}

type NegotiatedItem = Prisma.PriceListItemGetPayload<{
  include: {
    canonicalProduct: true;
    aliases: true;
    priceRules: true;
  };
}>;

type NegotiatedPriceRule = NegotiatedItem['priceRules'][number];

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
          matchedPriceRule: undefined,
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
          differencePercent: undefined,
        };
      }

      const matchedPriceRule = this.findApplicablePriceRule(invoiceItem, match);

      if (match.priceRules.length > 0 && !matchedPriceRule) {
        return {
          invoiceItem,
          matchedItem: match,
          matchedPriceRule: undefined,
          validationStatus: InvoiceItemValidationStatus.REQUIERE_REVISION,
          differencePercent: undefined,
        };
      }

      if (!this.unitsAreCompatible(invoiceItem.unit, match, matchedPriceRule)) {
        return {
          invoiceItem,
          matchedItem: match,
          matchedPriceRule,
          validationStatus: InvoiceItemValidationStatus.UNIDAD_INCOMPATIBLE,
          differencePercent: undefined,
        };
      }

      const negotiatedPrice = this.getNegotiatedUnitPrice(
        invoiceItem,
        match,
        matchedPriceRule,
      );

      if (negotiatedPrice === undefined || negotiatedPrice <= 0) {
        return {
          invoiceItem,
          matchedItem: match,
          matchedPriceRule,
          validationStatus: InvoiceItemValidationStatus.REQUIERE_REVISION,
          differencePercent: undefined,
        };
      }

      const invoicedPrice = Number(invoiceItem.unitPrice);
      const differencePercent =
        ((invoicedPrice - negotiatedPrice) / negotiatedPrice) * 100;
      const validationStatus = this.resolveStatus(differencePercent);

      return {
        invoiceItem,
        matchedItem: match,
        matchedPriceRule,
        validationStatus,
        differencePercent,
      };
    });

    const differences = validatedItems
      .filter(
        (item) => item.validationStatus !== InvoiceItemValidationStatus.OK,
      )
      .map((item) => this.toDifference(item));

    const summary = this.buildSummary(validatedItems);

    const response: InvoiceValidationResponse = {
      status: differences.length === 0 ? 'OK' : 'DIFFERENCES_FOUND',
      billingResult: this.resolveBillingResult(summary, differences.length),
      message: this.buildMessage(summary, differences.length),
      summary,
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
    const exactMatch = this.findExactMatchCodeMatch(invoiceItem, activeItems);

    if (exactMatch) {
      return exactMatch;
    }

    let bestMatch: NegotiatedItem | undefined;
    let bestScore = 0;

    for (const item of activeItems) {
      const score = this.matchScore(invoiceItem, item);

      if (
        score > bestScore ||
        (score === bestScore &&
          score > 0 &&
          bestMatch &&
          this.isNewer(item, bestMatch))
      ) {
        bestScore = score;
        bestMatch = item;
      }
    }

    return bestScore >= 0.55 ? bestMatch : undefined;
  }

  private findExactMatchCodeMatch(
    invoiceItem: ParsedInvoiceItem,
    activeItems: NegotiatedItem[],
  ) {
    const invoiceMatchCode = this.normalizeMatchCode(invoiceItem.matchCode);

    if (!invoiceMatchCode) {
      return undefined;
    }

    return activeItems
      .filter(
        (item) => this.normalizeMatchCode(item.matchCode) === invoiceMatchCode,
      )
      .sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      )[0];
  }

  private isNewer(left: NegotiatedItem, right: NegotiatedItem) {
    return left.updatedAt.getTime() > right.updatedAt.getTime();
  }

  private matchScore(invoiceItem: ParsedInvoiceItem, item: NegotiatedItem) {
    const invoiceMatchCode = this.normalizeMatchCode(invoiceItem.matchCode);
    const itemMatchCode = this.normalizeMatchCode(item.matchCode);
    const alternateMatchCodes = this.getAlternateMatchCodes(invoiceItem).map(
      (value) => this.normalizeMatchCode(value),
    );

    const matchCodeScore =
      invoiceMatchCode && itemMatchCode && invoiceMatchCode === itemMatchCode
        ? 0.65
        : itemMatchCode && alternateMatchCodes.includes(itemMatchCode)
          ? 0.65
          : 0;

    const candidates = [
      item.descriptionNormalized,
      item.descriptionRaw,
      item.canonicalProduct?.name,
      ...item.aliases.map((alias) => alias.aliasNormalized ?? alias.aliasRaw),
    ]
      .filter(Boolean)
      .map((value) => this.normalize(String(value)));

    const textScore = Math.max(
      ...candidates.map((candidate) =>
        Math.max(
          this.tokenSimilarity(invoiceItem.descriptionNormalized, candidate),
          this.productFeatureSimilarity(
            invoiceItem.descriptionNormalized,
            candidate,
          ),
        ),
      ),
      0,
    );

    return Math.min(
      0.99,
      Math.max(textScore, matchCodeScore) +
        this.dimensionScore(invoiceItem, item) +
        this.channelScore(invoiceItem, item),
    );
  }

  private dimensionScore(invoiceItem: ParsedInvoiceItem, item: NegotiatedItem) {
    const invoiceDimensions = [
      invoiceItem.lengthMm,
      invoiceItem.widthMm,
      invoiceItem.heightMm,
    ];
    const itemDimensions = [item.lengthMm, item.widthMm, item.heightMm];

    if (
      invoiceDimensions.some((value) => value === undefined) ||
      itemDimensions.some((value) => value === null)
    ) {
      return 0;
    }

    const allMatch = invoiceDimensions.every((value, index) => {
      const invoiceValue = Number(value);
      const itemValue = Number(itemDimensions[index]?.toString());

      return Number.isFinite(invoiceValue) && invoiceValue === itemValue;
    });

    return allMatch ? 0.1 : -0.15;
  }

  private channelScore(invoiceItem: ParsedInvoiceItem, item: NegotiatedItem) {
    if (!invoiceItem.channel || !item.channel) {
      return 0;
    }

    return invoiceItem.channel.trim().toUpperCase() ===
      item.channel.trim().toUpperCase()
      ? 0.05
      : -0.1;
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

  private productFeatureSimilarity(left: string, right: string) {
    const leftFeatures = this.extractProductFeatures(left);
    const rightFeatures = this.extractProductFeatures(right);

    if (!leftFeatures || !rightFeatures) {
      return 0;
    }

    const sizeMatches = leftFeatures.size === rightFeatures.size;
    const colorMatches = leftFeatures.color === rightFeatures.color;
    const handleMatches = leftFeatures.handle === rightFeatures.handle;

    if (sizeMatches && colorMatches && handleMatches) {
      return 0.92;
    }

    if (sizeMatches && colorMatches) {
      return 0.72;
    }

    return 0;
  }

  private extractProductFeatures(value: string) {
    const normalized = this.normalize(value);
    const sizeMatch = /(\d+)\D+(\d+)\D+(\d+)/i.exec(normalized);

    if (!sizeMatch) {
      return undefined;
    }

    const color = normalized.includes('blanc')
      ? 'BLANCO'
      : normalized.includes('marron')
        ? 'MARRON'
        : normalized.includes('negra')
          ? 'NEGRO'
          : normalized.includes('fucsia')
            ? 'FUCSIA'
            : normalized.includes('kraft')
              ? 'KRAFT'
              : undefined;
    const handle = normalized.includes('retorcida')
      ? 'RETORCIDA'
      : normalized.includes('plana')
        ? 'PLANA'
        : undefined;

    if (!color || !handle) {
      return undefined;
    }

    return {
      size: `${sizeMatch[1]}X${sizeMatch[2]}X${sizeMatch[3]}`,
      color,
      handle,
    };
  }

  private unitsAreCompatible(
    invoiceUnit: PriceUnit,
    negotiatedItem: NegotiatedItem,
    priceRule?: NegotiatedPriceRule,
  ) {
    const negotiatedUnit =
      priceRule?.normalizedUnit ??
      priceRule?.priceUnit ??
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

  private findApplicablePriceRule(
    invoiceItem: ParsedInvoiceItem,
    negotiatedItem: NegotiatedItem,
  ) {
    const activeRules = negotiatedItem.priceRules.filter(
      (rule) => rule.status === PriceItemStatus.ACTIVE,
    );

    if (activeRules.length === 0) {
      return undefined;
    }

    const quantity =
      invoiceItem.quantity === undefined
        ? undefined
        : Number(invoiceItem.quantity);

    if (quantity === undefined || !Number.isFinite(quantity)) {
      const baseRules = activeRules.filter(
        (rule) => !rule.minQuantity && !rule.maxQuantity,
      );

      return baseRules.length === 1 ? baseRules[0] : undefined;
    }

    const invoiceQuantity: number = quantity;

    return activeRules
      .filter((rule) => {
        const minQuantity = rule.minQuantity
          ? Number(rule.minQuantity.toString())
          : undefined;
        const maxQuantity = rule.maxQuantity
          ? Number(rule.maxQuantity.toString())
          : undefined;

        return (
          (minQuantity === undefined || invoiceQuantity >= minQuantity) &&
          (maxQuantity === undefined || invoiceQuantity <= maxQuantity)
        );
      })
      .sort((left, right) => {
        const leftMin = left.minQuantity
          ? Number(left.minQuantity.toString())
          : Number.NEGATIVE_INFINITY;
        const rightMin = right.minQuantity
          ? Number(right.minQuantity.toString())
          : Number.NEGATIVE_INFINITY;

        return rightMin - leftMin;
      })[0];
  }

  private getNegotiatedUnitPrice(
    invoiceItem: ParsedInvoiceItem,
    item: NegotiatedItem,
    priceRule?: NegotiatedPriceRule,
  ) {
    if (this.isFlatTotalPrice(item, priceRule)) {
      const quantity =
        invoiceItem.quantity === undefined
          ? undefined
          : Number(invoiceItem.quantity);

      if (
        quantity === undefined ||
        !Number.isFinite(quantity) ||
        quantity <= 0
      ) {
        return undefined;
      }

      return (
        Number((priceRule?.priceAmount ?? item.priceAmount).toString()) /
        quantity
      );
    }

    const normalizedUnitPrice =
      priceRule?.normalizedUnitPrice?.toString() ??
      item.normalizedUnitPrice?.toString();

    if (normalizedUnitPrice) {
      return Number(normalizedUnitPrice);
    }

    return (
      Number((priceRule?.priceAmount ?? item.priceAmount).toString()) /
      Number(
        (priceRule?.priceQuantityBase ?? item.priceQuantityBase).toString(),
      )
    );
  }

  private isFlatTotalPrice(
    item: NegotiatedItem,
    priceRule?: NegotiatedPriceRule,
  ) {
    const rawData = (priceRule?.rawData ?? item.rawData) as
      | { pricingMode?: unknown }
      | null
      | undefined;

    return rawData?.pricingMode === 'FLAT_TOTAL';
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
    matchedPriceRule?: NegotiatedPriceRule;
    validationStatus: InvoiceItemValidationStatus;
    differencePercent?: number;
  }): InvoiceDifference {
    const negotiatedUnit =
      item.matchedPriceRule?.normalizedUnit ??
      item.matchedPriceRule?.priceUnit ??
      item.matchedItem?.normalizedUnit ??
      item.matchedItem?.priceUnit ??
      PriceUnit.UNKNOWN;

    return {
      product: item.invoiceItem.descriptionRaw,
      negotiatedPrice: item.matchedItem
        ? this.formatNegotiatedPrice(
            item.invoiceItem,
            item.matchedItem,
            item.matchedPriceRule,
            negotiatedUnit,
          )
        : null,
      invoicedPrice: `${item.invoiceItem.unitPrice} EUR/ ${this.unitLabel(item.invoiceItem.unit)}`,
      differencePercent:
        item.differencePercent === undefined
          ? null
          : `${item.differencePercent >= 0 ? '+' : ''}${this.decimalString(item.differencePercent, 2)}%`,
      status: item.validationStatus,
      severity: this.resolveSeverity(item.validationStatus),
    };
  }

  private formatNegotiatedPrice(
    invoiceItem: ParsedInvoiceItem,
    matchedItem: NegotiatedItem,
    matchedPriceRule: NegotiatedPriceRule | undefined,
    negotiatedUnit: PriceUnit,
  ) {
    const negotiatedPrice = this.getNegotiatedUnitPrice(
      invoiceItem,
      matchedItem,
      matchedPriceRule,
    );

    if (negotiatedPrice === undefined) {
      return null;
    }

    if (this.isFlatTotalPrice(matchedItem, matchedPriceRule)) {
      const total = Number(
        (matchedPriceRule?.priceAmount ?? matchedItem.priceAmount).toString(),
      );

      return `${this.decimalString(total, 2)} EUR fijo (${this.decimalString(negotiatedPrice, 6)} EUR/ ${this.unitLabel(negotiatedUnit)})`;
    }

    return `${this.decimalString(negotiatedPrice, 6)} EUR/ ${this.unitLabel(negotiatedUnit)}`;
  }

  private buildSummary(
    items: Array<{ validationStatus: InvoiceItemValidationStatus }>,
  ): InvoiceValidationSummary {
    const count = (status: InvoiceItemValidationStatus) =>
      items.filter((item) => item.validationStatus === status).length;

    return {
      totalItems: items.length,
      ok: count(InvoiceItemValidationStatus.OK),
      overcharges: count(InvoiceItemValidationStatus.SOBRECOSTE),
      undercharges: count(InvoiceItemValidationStatus.PRECIO_MENOR),
      notFound: count(InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO),
      unitMismatches: count(InvoiceItemValidationStatus.UNIDAD_INCOMPATIBLE),
      requiresReview: count(InvoiceItemValidationStatus.REQUIERE_REVISION),
    };
  }

  private buildMessage(
    summary: InvoiceValidationSummary,
    differencesCount: number,
  ) {
    if (differencesCount === 0) {
      return 'Todos los productos fueron cobrados correctamente segun los precios negociados.';
    }

    if (summary.overcharges > 0) {
      return 'Se encontraron sobrecostes y diferencias para revisar.';
    }

    if (
      summary.undercharges > 0 &&
      summary.notFound === 0 &&
      summary.unitMismatches === 0 &&
      summary.requiresReview === 0
    ) {
      return 'No se detectaron sobrecostes. Hay productos facturados por debajo del precio negociado.';
    }

    return 'Se encontraron diferencias para revisar.';
  }

  private resolveBillingResult(
    summary: InvoiceValidationSummary,
    differencesCount: number,
  ) {
    if (differencesCount === 0) {
      return InvoiceBillingResult.OK;
    }

    if (summary.overcharges > 0) {
      return InvoiceBillingResult.OVERCHARGED;
    }

    if (
      summary.notFound > 0 ||
      summary.unitMismatches > 0 ||
      summary.requiresReview > 0
    ) {
      return InvoiceBillingResult.NEEDS_REVIEW;
    }

    return InvoiceBillingResult.NO_OVERCHARGE;
  }

  private resolveSeverity(
    status: InvoiceItemValidationStatus,
  ): InvoiceDifferenceSeverity {
    if (status === InvoiceItemValidationStatus.SOBRECOSTE) {
      return 'CRITICAL';
    }

    if (status === InvoiceItemValidationStatus.PRECIO_MENOR) {
      return 'INFO';
    }

    return 'REVIEW';
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

  private normalizeMatchCode(value?: string | null) {
    const normalized = value?.trim();

    return normalized ? normalized.toUpperCase() : undefined;
  }

  private getAlternateMatchCodes(invoiceItem: ParsedInvoiceItem) {
    const rawData = invoiceItem.rawData as
      | {
          extractor?: {
            alternateMatchCodes?: unknown;
          };
        }
      | null
      | undefined;
    const alternateMatchCodes = rawData?.extractor?.alternateMatchCodes;

    if (!Array.isArray(alternateMatchCodes)) {
      return [];
    }

    return alternateMatchCodes.filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  }
}
