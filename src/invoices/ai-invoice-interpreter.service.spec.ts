import {
  InvoiceItemValidationStatus,
  PriceItemStatus,
  PriceUnit,
} from '@prisma/client';
import { AiInvoiceInterpreterService } from './ai-invoice-interpreter.service';

describe('AiInvoiceInterpreterService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-4.1-mini',
      OPENAI_INVOICE_AI_SUPPLIERS: 'interpack',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('applies a valid AI correction when match code exists and math is valid', async () => {
    const service = new AiInvoiceInterpreterService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 0,
              action: 'UPDATE',
              matchCode: 'RESMA AN.PER3',
              quantity: 20000,
              unit: PriceUnit.UNIT,
              unitPrice: 0.0125,
              totalAmount: 250,
              confidence: 0.95,
              reason: 'Referencia y PAQ. * 1000H indican precio por millar.',
            },
          ],
        }),
        usage: {
          input_tokens: 1200,
          output_tokens: 200,
          total_tokens: 1400,
        },
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: 'RESMA ANT. PERIODICO 25*28 (PAQ. * 1000H.)',
        descriptionNormalized: 'resma ant periodico 25 28 paq 1000h',
        matchCode: 'RESMA ANPER3',
        quantity: '20.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '12.500000',
        totalAmount: '250.0000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
    ];
    const negotiatedItems = [
      negotiatedItem({
        matchCode: 'RESMA AN.PER3',
        descriptionRaw: 'RESMA ANT. PERIODICO 25*28 (PAQ. * 1000H.)',
        priceAmount: '12.5000',
        normalizedUnitPrice: '0.012500',
      }),
    ];

    const result = await service.interpretItems({
      supplierName: 'INTERPACK',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.SOBRECOSTE,
          differencePercent: 99900,
        },
      ],
      negotiatedItems,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      attempted: true,
      returnedCorrections: 1,
      appliedCorrections: 1,
    });
    expect(result.items[0]).toMatchObject({
      matchCode: 'RESMA AN.PER3',
      quantity: '20000.0000',
      unitPrice: '0.012500',
    });
    expect(result.items[0].rawData).toMatchObject({
      aiInterpretation: {
        provider: 'openai',
        confidence: 0.95,
      },
    });
  });

  it('keeps the original item when the AI correction does not pass safeguards', async () => {
    const service = new AiInvoiceInterpreterService();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 0,
              action: 'UPDATE',
              matchCode: 'UNKNOWN',
              quantity: 20,
              unit: PriceUnit.UNIT,
              unitPrice: 1,
              totalAmount: 250,
              confidence: 0.99,
              reason: 'Bad correction',
            },
          ],
        }),
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: 'RESMA ANT. PERIODICO 25*28 (PAQ. * 1000H.)',
        descriptionNormalized: 'resma ant periodico 25 28 paq 1000h',
        matchCode: 'RESMA ANPER3',
        quantity: '20.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '12.500000',
        totalAmount: '250.0000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'INTERPACK',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.SOBRECOSTE,
        },
      ],
      negotiatedItems: [
        negotiatedItem({
          matchCode: 'RESMA AN.PER3',
          descriptionRaw: 'RESMA ANT. PERIODICO 25*28 (PAQ. * 1000H.)',
          priceAmount: '12.5000',
          normalizedUnitPrice: '0.012500',
        }),
      ],
    });

    expect(result).toMatchObject({
      attempted: true,
      returnedCorrections: 1,
      appliedCorrections: 0,
    });
    expect(result.items[0]).toMatchObject({
      matchCode: 'RESMA ANPER3',
      quantity: '20.0000',
      unitPrice: '12.500000',
    });
  });
});

function negotiatedItem(input: {
  matchCode: string;
  descriptionRaw: string;
  priceAmount: string;
  normalizedUnitPrice: string;
}) {
  const now = new Date();

  return {
    id: input.matchCode,
    priceListId: 'price-list-id',
    supplierId: 'supplier-id',
    canonicalProductId: null,
    matchCode: input.matchCode,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    descriptionRaw: input.descriptionRaw,
    descriptionNormalized: input.descriptionRaw.toLowerCase(),
    channel: null,
    priceAmount: input.priceAmount,
    currency: 'EUR',
    priceUnit: PriceUnit.THOUSAND_UNITS,
    priceQuantityBase: '1000',
    rawUnitLabel: 'millar',
    normalizedUnitPrice: input.normalizedUnitPrice,
    normalizedUnit: PriceUnit.UNIT,
    discountPercent: null,
    taxPercent: null,
    status: PriceItemStatus.ACTIVE,
    rowIndex: null,
    pageNumber: null,
    rawData: null,
    createdAt: now,
    updatedAt: now,
    canonicalProduct: null,
    aliases: [],
    priceRules: [],
  };
}
