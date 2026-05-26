import {
  InvoiceBillingResult,
  InvoiceItemValidationStatus,
  PriceItemStatus,
  PriceUnit,
} from '@prisma/client';
import { InvoiceValidationService } from './invoice-validation.service';

describe('InvoiceValidationService', () => {
  let service: InvoiceValidationService;

  beforeEach(() => {
    service = new InvoiceValidationService();
  });

  it('returns differences when invoiced price is higher than negotiated price', () => {
    const result = service.validate(
      [
        {
          descriptionRaw: 'Tornillo zincado 4x40',
          descriptionNormalized: 'tornillo zincado 4x40',
          unit: PriceUnit.UNIT,
          unitPrice: '0.520000',
          currency: 'EUR',
          rowIndex: 0,
          rawData: {},
        },
      ],
      [
        {
          id: 'price-list-item-id',
          priceListId: 'price-list-id',
          supplierId: 'supplier-id',
          canonicalProductId: null,
          matchCode: null,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          descriptionRaw: 'Tornillo zincado 4x40',
          descriptionNormalized: 'tornillo zincado 4x40',
          channel: null,
          priceAmount: '0.4594',
          currency: 'EUR',
          priceUnit: PriceUnit.UNIT,
          priceQuantityBase: '1',
          rawUnitLabel: 'unidad',
          normalizedUnitPrice: '0.4594',
          normalizedUnit: PriceUnit.UNIT,
          discountPercent: null,
          taxPercent: null,
          status: PriceItemStatus.ACTIVE,
          rowIndex: null,
          pageNumber: null,
          rawData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          canonicalProduct: null,
          aliases: [],
          priceRules: [],
        },
      ],
    );

    expect(result.response).toMatchObject({
      status: 'DIFFERENCES_FOUND',
      billingResult: InvoiceBillingResult.OVERCHARGED,
      summary: {
        totalItems: 1,
        ok: 0,
        overcharges: 1,
        undercharges: 0,
        notFound: 0,
        unitMismatches: 0,
        requiresReview: 0,
      },
      differences: [
        {
          product: 'Tornillo zincado 4x40',
          status: InvoiceItemValidationStatus.SOBRECOSTE,
          severity: 'CRITICAL',
        },
      ],
    });
  });

  it('keeps lower prices as informational differences', () => {
    const result = service.validate(
      [
        {
          descriptionRaw: 'Tornillo zincado 4x40',
          descriptionNormalized: 'tornillo zincado 4x40',
          unit: PriceUnit.UNIT,
          unitPrice: '0.400000',
          currency: 'EUR',
          rowIndex: 0,
          rawData: {},
        },
      ],
      [
        {
          id: 'price-list-item-id',
          priceListId: 'price-list-id',
          supplierId: 'supplier-id',
          canonicalProductId: null,
          matchCode: null,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          descriptionRaw: 'Tornillo zincado 4x40',
          descriptionNormalized: 'tornillo zincado 4x40',
          channel: null,
          priceAmount: '0.4594',
          currency: 'EUR',
          priceUnit: PriceUnit.UNIT,
          priceQuantityBase: '1',
          rawUnitLabel: 'unidad',
          normalizedUnitPrice: '0.4594',
          normalizedUnit: PriceUnit.UNIT,
          discountPercent: null,
          taxPercent: null,
          status: PriceItemStatus.ACTIVE,
          rowIndex: null,
          pageNumber: null,
          rawData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          canonicalProduct: null,
          aliases: [],
          priceRules: [],
        },
      ],
    );

    expect(result.response).toMatchObject({
      status: 'DIFFERENCES_FOUND',
      billingResult: InvoiceBillingResult.NO_OVERCHARGE,
      message:
        'No se detectaron sobrecostes. Hay productos facturados por debajo del precio negociado.',
      summary: {
        totalItems: 1,
        ok: 0,
        overcharges: 0,
        undercharges: 1,
        notFound: 0,
        unitMismatches: 0,
        requiresReview: 0,
      },
      differences: [
        {
          product: 'Tornillo zincado 4x40',
          status: InvoiceItemValidationStatus.PRECIO_MENOR,
          severity: 'INFO',
        },
      ],
    });
  });

  it('uses the newest negotiated item when duplicate matches have the same score', () => {
    const oldDate = new Date('2026-01-01T00:00:00.000Z');
    const newDate = new Date('2026-02-01T00:00:00.000Z');
    const baseNegotiatedItem = {
      id: 'old-price-list-item-id',
      priceListId: 'price-list-id',
      supplierId: 'supplier-id',
      canonicalProductId: null,
      matchCode: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      descriptionRaw: 'KRAFT-BICO',
      descriptionNormalized: 'kraft bico',
      channel: null,
      priceAmount: '0.4591',
      currency: 'EUR',
      priceUnit: PriceUnit.M2,
      priceQuantityBase: '1',
      rawUnitLabel: 'm2',
      normalizedUnitPrice: '0.4591',
      normalizedUnit: PriceUnit.M2,
      discountPercent: null,
      taxPercent: null,
      status: PriceItemStatus.ACTIVE,
      rowIndex: null,
      pageNumber: null,
      rawData: null,
      createdAt: oldDate,
      updatedAt: oldDate,
      canonicalProduct: null,
      aliases: [],
      priceRules: [],
    };

    const result = service.validate(
      [
        {
          descriptionRaw: 'KRAFT-BICO',
          descriptionNormalized: 'kraft bico',
          unit: PriceUnit.M2,
          unitPrice: '0.479100',
          currency: 'EUR',
          rowIndex: 0,
          rawData: {},
        },
      ],
      [
        baseNegotiatedItem,
        {
          ...baseNegotiatedItem,
          id: 'new-price-list-item-id',
          priceAmount: '0.5078',
          normalizedUnitPrice: '0.5078',
          updatedAt: newDate,
        },
      ],
    );

    expect(result.response.differences[0]).toMatchObject({
      negotiatedPrice: '0.507800 EUR/ m2',
      status: InvoiceItemValidationStatus.PRECIO_MENOR,
    });
  });

  it('uses the applicable price rule by invoice quantity', () => {
    const result = service.validate(
      [
        {
          descriptionRaw: 'PIZZA 30 ANONIMA',
          descriptionNormalized: 'pizza 30 anonima',
          quantity: '25000.0000',
          unit: PriceUnit.UNIT,
          unitPrice: '0.140000',
          currency: 'EUR',
          rowIndex: 0,
          rawData: {},
        },
      ],
      [
        {
          id: 'price-list-item-id',
          priceListId: 'price-list-id',
          supplierId: 'supplier-id',
          canonicalProductId: null,
          matchCode: null,
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          descriptionRaw: 'PIZZA 30 ANONIMA',
          descriptionNormalized: 'pizza 30 anonima',
          channel: null,
          priceAmount: '141.9600',
          currency: 'EUR',
          priceUnit: PriceUnit.THOUSAND_UNITS,
          priceQuantityBase: '1000',
          rawUnitLabel: 'millar',
          normalizedUnitPrice: '0.141960',
          normalizedUnit: PriceUnit.UNIT,
          discountPercent: null,
          taxPercent: null,
          status: PriceItemStatus.ACTIVE,
          rowIndex: null,
          pageNumber: null,
          rawData: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          canonicalProduct: null,
          aliases: [],
          priceRules: [
            {
              id: 'rule-10000',
              priceListItemId: 'price-list-item-id',
              minQuantity: { toString: () => '10000' },
              maxQuantity: null,
              priceAmount: { toString: () => '141.9600' },
              currency: 'EUR',
              priceUnit: PriceUnit.THOUSAND_UNITS,
              priceQuantityBase: { toString: () => '1000' },
              rawUnitLabel: 'millar',
              normalizedUnitPrice: { toString: () => '0.141960' },
              normalizedUnit: PriceUnit.UNIT,
              discountPercent: null,
              taxPercent: null,
              status: PriceItemStatus.ACTIVE,
              rawData: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'rule-20000',
              priceListItemId: 'price-list-item-id',
              minQuantity: { toString: () => '20000' },
              maxQuantity: null,
              priceAmount: { toString: () => '134.2100' },
              currency: 'EUR',
              priceUnit: PriceUnit.THOUSAND_UNITS,
              priceQuantityBase: { toString: () => '1000' },
              rawUnitLabel: 'millar',
              normalizedUnitPrice: { toString: () => '0.134210' },
              normalizedUnit: PriceUnit.UNIT,
              discountPercent: null,
              taxPercent: null,
              status: PriceItemStatus.ACTIVE,
              rawData: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      ],
    );

    expect(result.items[0].matchedPriceRule?.id).toBe('rule-20000');
    expect(result.response.differences[0]).toMatchObject({
      negotiatedPrice: '0.134210 EUR/ ud',
      status: InvoiceItemValidationStatus.SOBRECOSTE,
    });
  });

  it('supports fixed total price tiers as an effective unit price', () => {
    const result = service.validate(
      [
        {
          descriptionRaw: 'TROQUELADO VASO 7 OZ P48 CONTINENTAL-ANTICO',
          descriptionNormalized: 'troquelado vaso 7 oz p48 continental antico',
          matchCode: 'SOTO_TROQUELADO_HASTA_52X70',
          quantity: '1030.0000',
          unit: PriceUnit.UNIT,
          unitPrice: '0.045000',
          totalAmount: '46.3500',
          currency: 'EUR',
          rowIndex: 0,
          rawData: {},
        },
      ],
      [
        {
          id: 'soto-small-die-cut',
          priceListId: 'price-list-id',
          supplierId: 'supplier-id',
          canonicalProductId: null,
          matchCode: 'SOTO_TROQUELADO_HASTA_52X70',
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          descriptionRaw: 'TARIFA TROQUELADO HASTA 52 x 70',
          descriptionNormalized: 'tarifa troquelado hasta 52 x 70',
          channel: null,
          priceAmount: '52.0000',
          currency: 'EUR',
          priceUnit: PriceUnit.UNIT,
          priceQuantityBase: '1',
          rawUnitLabel: 'hoja',
          normalizedUnitPrice: null,
          normalizedUnit: PriceUnit.UNIT,
          discountPercent: null,
          taxPercent: null,
          status: PriceItemStatus.ACTIVE,
          rowIndex: null,
          pageNumber: null,
          rawData: { pricingMode: 'FLAT_TOTAL' },
          createdAt: new Date(),
          updatedAt: new Date(),
          canonicalProduct: null,
          aliases: [],
          priceRules: [
            {
              id: 'flat-1100',
              priceListItemId: 'soto-small-die-cut',
              minQuantity: null,
              maxQuantity: { toString: () => '1100' },
              priceAmount: { toString: () => '52.0000' },
              currency: 'EUR',
              priceUnit: PriceUnit.UNIT,
              priceQuantityBase: { toString: () => '1' },
              rawUnitLabel: 'fijo',
              normalizedUnitPrice: null,
              normalizedUnit: PriceUnit.UNIT,
              discountPercent: null,
              taxPercent: null,
              status: PriceItemStatus.ACTIVE,
              rawData: { pricingMode: 'FLAT_TOTAL' },
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'unit-1101',
              priceListItemId: 'soto-small-die-cut',
              minQuantity: { toString: () => '1101' },
              maxQuantity: { toString: () => '2100' },
              priceAmount: { toString: () => '0.0450' },
              currency: 'EUR',
              priceUnit: PriceUnit.UNIT,
              priceQuantityBase: { toString: () => '1' },
              rawUnitLabel: 'hoja',
              normalizedUnitPrice: { toString: () => '0.045000' },
              normalizedUnit: PriceUnit.UNIT,
              discountPercent: null,
              taxPercent: null,
              status: PriceItemStatus.ACTIVE,
              rawData: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      ],
    );

    expect(result.items[0].matchedPriceRule?.id).toBe('flat-1100');
    expect(result.response.differences[0]).toMatchObject({
      negotiatedPrice: '52.00 EUR fijo (0.050485 EUR/ ud)',
      status: InvoiceItemValidationStatus.PRECIO_MENOR,
    });
  });
});
