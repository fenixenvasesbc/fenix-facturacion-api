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
    process.env.OPENAI_INVOICE_AI_ALLOW_UPDATE = 'true';
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
    process.env.OPENAI_INVOICE_AI_ALLOW_UPDATE = 'true';
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

  it('skips OpenAI when only real products need catalog review and updates are disabled', async () => {
    const service = new AiInvoiceInterpreterService();
    const fetchMock = jest.spyOn(global, 'fetch');
    const invoiceItems = [
      {
        descriptionRaw:
          'RESMA ANTIGRASA 63,5X86 CM 40GR 400H IMP. CORTE 60X40',
        descriptionNormalized:
          'resma antigrasa 63 5x86 cm 40gr 400h imp corte 60x40',
        matchCode: 'INTERPACK_RESMA_ANTIGRASA_CORTE_60X40',
        quantity: '20.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '34.300000',
        totalAmount: '686.0000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
      {
        descriptionRaw: '10+4*31 BOLSA PAPEL ANTIGRASA IMP.',
        descriptionNormalized: '10 4 31 bolsa papel antigrasa imp',
        matchCode: '10431AI',
        quantity: '50000.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '0.020400',
        totalAmount: '1020.0000',
        currency: 'EUR',
        rowIndex: 1,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'INTERPACK',
      invoiceItems,
      validationItems: invoiceItems.map((invoiceItem) => ({
        invoiceItem,
        validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
      })),
      negotiatedItems: [
        negotiatedItem({
          matchCode: 'CLICHES',
          descriptionRaw: 'CLICHES',
          priceAmount: '65',
          normalizedUnitPrice: '65',
        }),
      ],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      attempted: false,
      appliedCorrections: 0,
      returnedCorrections: 0,
    });
    expect(result.items).toHaveLength(2);
  });

  it('drops phantom invoice fragments when AI returns DROP with enough confidence', async () => {
    const service = new AiInvoiceInterpreterService();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 1,
              action: 'DROP',
              matchCode: null,
              quantity: null,
              unit: null,
              unitPrice: null,
              totalAmount: null,
              confidence: 0.96,
              reason: 'IVA/tax fragment, not a product line.',
            },
          ],
        }),
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: 'RESMA ANT. PERIODICO 25*28 (PAQ. * 1000H.)',
        descriptionNormalized: 'resma ant periodico 25 28 paq 1000h',
        matchCode: 'RESMA AN.PER3',
        quantity: '20000.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '0.012500',
        totalAmount: '250.0000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
      {
        descriptionRaw: '% I.V.A. 2,00',
        descriptionNormalized: 'i v a 2 00',
        matchCode: 'I.V.A.',
        quantity: '1.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '26.800000',
        totalAmount: '26.8000',
        currency: 'EUR',
        rowIndex: 1,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'INTERPACK',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.OK,
        },
        {
          invoiceItem: invoiceItems[1],
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
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
      appliedCorrections: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].matchCode).toBe('RESMA AN.PER3');
  });

  it('uses the same drop-only AI flow for Plastivalle tax fragments', async () => {
    process.env.OPENAI_INVOICE_AI_SUPPLIERS = 'interpack,plastivalle';
    const service = new AiInvoiceInterpreterService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 1,
              action: 'DROP',
              matchCode: null,
              quantity: null,
              unit: null,
              unitPrice: null,
              totalAmount: null,
              confidence: 0.96,
              reason: 'Tax line, not a Plastivalle product row.',
            },
          ],
        }),
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: '24+11X32 GR-80 BOLSA PAPEL BLANCA ASA RETORCIDA',
        descriptionNormalized:
          '24 11x32 gr 80 bolsa papel blanca asa retorcida',
        matchCode: 'GEN241132B',
        quantity: '2000.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '0.107600',
        totalAmount: '215.2000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
      {
        descriptionRaw: '% I.V.A. 21,00',
        descriptionNormalized: 'i v a 21 00',
        matchCode: 'I.V.A.',
        quantity: '1.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '45.192000',
        totalAmount: '45.1920',
        currency: 'EUR',
        rowIndex: 1,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'PLASTIVALLE',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.OK,
        },
        {
          invoiceItem: invoiceItems[1],
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
        },
      ],
      negotiatedItems: [
        negotiatedItem({
          matchCode: 'GEN241132B',
          descriptionRaw: '24X11X32 GR-80 BOLSA PAPEL BLANCA ASA RETORCIDA',
          priceAmount: '107.6',
          normalizedUnitPrice: '0.1076',
        }),
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      attempted: true,
      returnedCorrections: 1,
      appliedCorrections: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].matchCode).toBe('GEN241132B');
  });

  it('enables Saica and Soto by default for drop-only AI review', async () => {
    delete process.env.OPENAI_INVOICE_AI_SUPPLIERS;
    const service = new AiInvoiceInterpreterService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 1,
              action: 'DROP',
              matchCode: null,
              quantity: null,
              unit: null,
              unitPrice: null,
              totalAmount: null,
              confidence: 0.96,
              reason: 'Tax or footer line, not a product row.',
            },
          ],
        }),
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: 'PIZZA 30 ANONIMA MARRON SIN PAQUETES',
        descriptionNormalized: 'pizza 30 anonima marron sin paquetes',
        matchCode: 'PIZZA_30',
        quantity: '1000.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '0.129050',
        totalAmount: '129.0500',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
      {
        descriptionRaw: '% I.V.A. 21,00',
        descriptionNormalized: 'i v a 21 00',
        matchCode: 'I.V.A.',
        quantity: '1.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '27.100000',
        totalAmount: '27.1000',
        currency: 'EUR',
        rowIndex: 1,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'SAICA PACK',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.OK,
        },
        {
          invoiceItem: invoiceItems[1],
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
        },
      ],
      negotiatedItems: [
        negotiatedItem({
          matchCode: 'PIZZA_30',
          descriptionRaw: 'PIZZA 30 ANONIMA MARRON SIN PAQUETES',
          priceAmount: '0.12905',
          normalizedUnitPrice: '0.12905',
        }),
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      attempted: true,
      appliedCorrections: 1,
    });
    expect(result.items).toHaveLength(1);
  });

  it('enables Mora y Goma and Drako by default for drop-only AI review', async () => {
    delete process.env.OPENAI_INVOICE_AI_SUPPLIERS;
    const service = new AiInvoiceInterpreterService();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          corrections: [
            {
              itemIndex: 1,
              action: 'DROP',
              matchCode: null,
              quantity: null,
              unit: null,
              unitPrice: null,
              totalAmount: null,
              confidence: 0.96,
              reason: 'Footer total, not a product row.',
            },
          ],
        }),
      }),
    } as Response);

    const invoiceItems = [
      {
        descriptionRaw: 'BOLSA PAPEL MARRON ASA PLANA',
        descriptionNormalized: 'bolsa papel marron asa plana',
        matchCode: 'DRAKO_BOLSA_MARRON',
        quantity: '1000.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '0.078000',
        totalAmount: '78.0000',
        currency: 'EUR',
        rowIndex: 0,
        rawData: {},
      },
      {
        descriptionRaw: 'TOTAL FACTURA',
        descriptionNormalized: 'total factura',
        matchCode: null,
        quantity: '1.0000',
        unit: PriceUnit.UNIT,
        unitPrice: '78.000000',
        totalAmount: '78.0000',
        currency: 'EUR',
        rowIndex: 1,
        rawData: {},
      },
    ];

    const result = await service.interpretItems({
      supplierName: 'DRAKO IMPRESORES',
      invoiceItems,
      validationItems: [
        {
          invoiceItem: invoiceItems[0],
          validationStatus: InvoiceItemValidationStatus.OK,
        },
        {
          invoiceItem: invoiceItems[1],
          validationStatus: InvoiceItemValidationStatus.PRODUCTO_NO_ENCONTRADO,
        },
      ],
      negotiatedItems: [
        negotiatedItem({
          matchCode: 'DRAKO_BOLSA_MARRON',
          descriptionRaw: 'BOLSA PAPEL MARRON ASA PLANA',
          priceAmount: '0.078',
          normalizedUnitPrice: '0.078',
        }),
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      attempted: true,
      appliedCorrections: 1,
    });
    expect(result.items).toHaveLength(1);
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
