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
      negotiatedPrice: '0.507800 €/ m2',
      status: InvoiceItemValidationStatus.PRECIO_MENOR,
    });
  });
});
