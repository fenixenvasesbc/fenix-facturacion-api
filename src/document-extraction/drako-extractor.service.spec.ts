import { PriceUnit } from '@prisma/client';
import { DrakoExtractorService } from './drako-extractor.service';

describe('DrakoExtractorService', () => {
  let service: DrakoExtractorService;

  beforeEach(() => {
    service = new DrakoExtractorService();
  });

  it('extracts Drako invoice rows and assigns negotiated family match codes', () => {
    const items = service.extractInvoice({
      supplierName: 'DRAKO IMPRESORES, S.L.U.',
      rawText: `
Documento
Número
ARTÍCULO
DESCRIPCIÓN
CANTIDAD
PRECIO UD.
SUBTOTAL
TOTAL
Factura
DRAKO IMPRESORES, S.L.U.
Albarán:
1-000296
21/05/2026
ANTIGRASA 25 X 28 HOTEL EMBARCADERO
19385
5.000,00
0,019
95,00
95,00
ANTIGRASA 31 X 31 DEVITECA PEDIDO 18951
5.000,00
0,022
110,00
110,00
ANTIGRASA 28 X 34 DELIRI-COOPFRODITA
PEDIDO 17961
5.000,00
0,022
110,00
110,00
Albarán:
1-000302
25/05/2026
VASOS 4 OZ 15000 UNIDADES PEDIDO N 007
1.000,00
0,215
215,00
215,00
VASOS 8 OZ  12000 UNIDADES PEDIDO N 004
1.000,00
0,215
215,00
215,00
TOTAL:
1.349,15
`,
    });

    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'ANTIGRASA 25 X 28 HOTEL EMBARCADERO',
      matchCode: 'DRAKO_ANTIGRASA_25X28',
      reference: '19385',
      quantity: '5000.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.019000',
      totalAmount: '95.0000',
    });
    expect(items[1]).toMatchObject({
      descriptionRaw: 'ANTIGRASA 31 X 31 DEVITECA PEDIDO 18951',
      matchCode: 'DRAKO_ANTIGRASA_31X31_28X34_28X31',
      quantity: '5000.0000',
      unitPrice: '0.022000',
      totalAmount: '110.0000',
    });
    expect(items[2]).toMatchObject({
      descriptionRaw: 'ANTIGRASA 28 X 34 DELIRI-COOPFRODITA PEDIDO 17961',
      matchCode: 'DRAKO_ANTIGRASA_31X31_28X34_28X31',
      quantity: '5000.0000',
      unitPrice: '0.022000',
      totalAmount: '110.0000',
    });
    expect(items[3]).toMatchObject({
      descriptionRaw: 'VASOS 4 OZ 15000 UNIDADES PEDIDO N 007',
      matchCode: 'DRAKO_LAMINAS_1_CARA',
      quantity: '1000.0000',
      unitPrice: '0.215000',
      totalAmount: '215.0000',
    });
  });

  it('maps burger families to two-sided laminas and pegatinas to adhesivos', () => {
    const items = service.extractInvoice({
      supplierName: 'DRAKO',
      rawText: `
PALAS BURGER HAMBURGUESA KRAFT
2.000,00
0,206
412,00
412,00
PEGATINAS REDONDAS 5 CM
1.000,00
0,045
45,00
45,00
`,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      matchCode: 'DRAKO_LAMINAS_2_CARAS',
      quantity: '2000.0000',
    });
    expect(items[1]).toMatchObject({
      matchCode: 'DRAKO_ADHESIVO_REDONDO_5CM',
      quantity: '1000.0000',
    });
  });
});
