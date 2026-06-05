import { PriceUnit } from '@prisma/client';
import { GenericInvoiceExtractorService } from './generic-invoice-extractor.service';

describe('GenericInvoiceExtractorService', () => {
  const originalEnv = process.env;
  let service: GenericInvoiceExtractorService;

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    service = new GenericInvoiceExtractorService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('extracts invoice rows from generic OCR tables using reference as match code', async () => {
    const items = await service.extractInvoice({
      supplierName: 'VASO MADRID',
      rawData: {
        ocr: {
          tables: [
            {
              page: 1,
              rows: [
                ['Referencia', 'Descripcion', 'Cantidad', 'Precio', 'Importe'],
                [
                  'SMRK4',
                  'VASO CARTON 4oz. KRAFT "BOULANGERIE"',
                  '5,00',
                  '32,130',
                  '160,65',
                ],
                ['MAQUETACION', 'MAQUETACION', '1,00', '30,00', '30,00'],
                ['MAQUETACION', 'MAQUETACION', '1,00', '30,00', '30,00'],
                ['MAQUETACION', 'MAQUETACION', '1,00', '30,00', '30,00'],
                ['1.231,88', '1.231,88', '', '258,69', '258,69'],
                ['Vencimientos', '/04/ - Operacion asegurada', '', '', ''],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'VASO CARTON 4oz. KRAFT "BOULANGERIE"',
      matchCode: 'SMRK4',
      reference: 'SMRK4',
      quantity: '5000.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.032130',
      totalAmount: '160.6500',
    });
    expect(items.filter((item) => item.matchCode === 'MAQUETACION')).toHaveLength(
      3,
    );
    expect(items[1]).toMatchObject({
      descriptionRaw: 'MAQUETACION',
      matchCode: 'MAQUETACION',
      quantity: '1.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '30.000000',
      totalAmount: '30.0000',
    });
  });

  it('promotes the real reference when OCR puts a generic label in the reference column', async () => {
    const items = await service.extractInvoice({
      supplierName: 'VASO MADRID',
      rawData: {
        ocr: {
          tables: [
            {
              rows: [
                [
                  'Referencia',
                  'Descripcion',
                  'Detalle',
                  'Cantidad',
                  'Precio',
                  'Importe',
                ],
                [
                  'Folio',
                  'TSMR4N100',
                  'TAPA VASO CARTON 4oz TRAVEL-NEGRA 62mm',
                  '4,00',
                  '22,590',
                  '90,36',
                ],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'TAPA VASO CARTON 4oz TRAVEL-NEGRA 62mm',
      matchCode: 'TSMR4N100',
      reference: 'TSMR4N100',
      quantity: '4000.0000',
      unitPrice: '0.022590',
    });
  });

  it('keeps square meter rows as M2 instead of normalizing them as units', async () => {
    const items = await service.extractInvoice({
      supplierName: 'PROVEEDOR GENERICO',
      rawData: {
        ocr: {
          tables: [
            {
              rows: [
                [
                  'Codigo',
                  'Concepto',
                  'Cantidad',
                  'Unidad',
                  'Precio Unitario',
                  'Importe',
                ],
                ['LAM001', 'LAMINA IMPRESA', '12,50', 'm2', '3,20', '40,00'],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchCode: 'LAM001',
      quantity: '12.5000',
      unit: PriceUnit.M2,
      unitPrice: '3.200000',
      totalAmount: '40.0000',
    });
  });

  it('uses AI fallback only when table headers cannot be detected', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          items: [
            {
              descriptionRaw: 'VASO CARTON 8oz KRAFT',
              matchCode: 'SMRK8',
              reference: 'SMRK8',
              quantity: 5,
              unit: PriceUnit.THOUSAND_UNITS,
              unitPrice: 51.97,
              totalAmount: 259.85,
              currency: 'EUR',
              rowIndex: 0,
              confidence: 0.91,
              reason: 'Detected product row with reference and price per thousand.',
            },
          ],
        }),
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
        },
      }),
    } as Response);

    const items = await service.extractInvoice({
      supplierName: 'VASO MADRID',
      rawText: 'SMRK8 VASO CARTON 8oz KRAFT 5,00 51,970 259,85',
      rawData: {
        ocr: {
          tables: [
            {
              rows: [['SMRK8', 'VASO CARTON 8oz KRAFT', '5,00', '51,970']],
            },
          ],
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchCode: 'SMRK8',
      quantity: '5000.0000',
      unitPrice: '0.051970',
    });
  });
});
