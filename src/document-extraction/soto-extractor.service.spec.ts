import { PriceUnit } from '@prisma/client';
import { SotoExtractorService } from './soto-extractor.service';

describe('SotoExtractorService', () => {
  let service: SotoExtractorService;

  beforeEach(() => {
    service = new SotoExtractorService();
  });

  it('extracts unit-priced invoice items from Soto embedded text', () => {
    const items = service.extractInvoice({
      supplierName: 'SERVICIOS GRAFICOS SOTO',
      rawText: `
N.1.F.: B13869839
SERVICIOS
GRÁFICOS
SOTO
FACTURA NÚM.
A 26000146
CODIGO
CONCEPTO
TAMANO
CANTIDAD
PRECIO
IMPORTE
ALBARÁN A-2056 FECHA 28/04/2026
101
TROQUELADO 68X83 COMBO KRAFT P46 24220
9.000,00
0,036
324,00
101 TROQUELADO 67X104 ENVIO KRAFT P49 24152 2.500,00 0,058 145,00
101 TROQUELADO 62X78 ENVIO KRAFT P49 10367 1.200,00 0,062 74,40
101 TROQUELADO VASO 7 OZ P50 BACANO-MARIO 1.030,00 0,045 46,35
101
TROQUELADO VASO 7 OZ P48
CONTINENTAL-ANTICO
1.030,00
0,045
46,35
101 TROQUELADO VASO 4 OZ P50 NUBA-PASCAL 1.030,00 0,045 46,35
101 TROQUELADO VASO 4 OZ P45 SAISEI-MOMENT 1.030,00 0,045 46,35
FORMA DE PAGO:
BASE IMPONIBLE
728,80
`,
    });

    expect(items).toHaveLength(7);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'TROQUELADO 68X83 COMBO KRAFT P46 24220',
      matchCode: 'SOTO_TROQUELADO_COMBO',
      reference: '101',
      quantity: '9000.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.036000',
      totalAmount: '324.0000',
    });
    expect(items[4]).toMatchObject({
      descriptionRaw: 'TROQUELADO VASO 7 OZ P48 CONTINENTAL-ANTICO',
      matchCode: 'SOTO_TROQUELADO_HASTA_52X70',
      quantity: '1030.0000',
      unitPrice: '0.045000',
      totalAmount: '46.3500',
    });
  });

  it('supports table rows from OCR output', () => {
    const items = service.extractInvoice({
      supplierName: 'SOTO',
      rawData: {
        ocr: {
          tables: [
            {
              page: 1,
              rows: [
                ['ALBARÁN A-2056 FECHA 28/04/2026'],
                [
                  '101',
                  'TROQUELADO 67X104 ENVIO KRAFT P49 24152',
                  '2.500,00',
                  '0,058',
                  '145,00',
                ],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'TROQUELADO 67X104 ENVIO KRAFT P49 24152',
      matchCode: 'SOTO_TROQUELADO_MAS_52X70',
      quantity: '2500.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.058000',
      totalAmount: '145.0000',
    });
  });
});
