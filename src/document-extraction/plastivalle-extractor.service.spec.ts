import { PriceUnit } from '@prisma/client';
import { PlastivalleExtractorService } from './plastivalle-extractor.service';

describe('PlastivalleExtractorService', () => {
  let service: PlastivalleExtractorService;

  beforeEach(() => {
    service = new PlastivalleExtractorService();
  });

  it('extracts Plastivalle invoice rows with block reference and price per thousand', () => {
    const items = service.extractInvoice({
      supplierName: 'PLASTIVALLE S.L.',
      rawText: `
FACTURA
Cod. Artículo
Descripción
Cantidad
Precio
Importe
Albarán nº 2600092 del 12-03-2026
AN1455PP
14X55 G-100 BOLSAS ANÓNIMAS P-P
35,100
20,500
719,550
bultos 5 lote 26/280641
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: '14X55 G-100 BOLSAS ANÓNIMAS P-P',
      descriptionNormalized: '14x55 g 100 bolsas anonimas p p',
      matchCode: 'AN1455PP',
      reference: 'AN1455PP',
      quantity: '35100.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.020500',
      totalAmount: '719.5500',
    });
  });

  it('extracts Plastivalle albaran rows with mixed block and inline references', () => {
    const items = service.extractInvoice({
      supplierName: 'PLASTIVALLE',
      rawText: `
GEN321728M
32+17X28 BOLSAS PAPEL MARRÓN ASA PLANA
1,200
99,700
119,640
GEN322225M
32+22X25 GR-80 BOLSA PAPEL MARRÓN ASA PLANA
15,000
105,500
1.582,500
GEN25934M
25+9X34 GR-80 BOLSA PAPEL MARRÓN ASA PLANA
5,200
79,200
411,840
GEN321740FUC 32+17X40 GR 80 BOLSAS PAPEL FUCSIA ASA PLANA
3,000
188,700
566,100
`,
    });

    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      matchCode: 'GEN321728M',
      quantity: '1200.0000',
      unitPrice: '0.099700',
      totalAmount: '119.6400',
    });
    expect(items[1]).toMatchObject({
      matchCode: 'GEN322225M',
      quantity: '15000.0000',
      unitPrice: '0.105500',
      totalAmount: '1582.5000',
    });
    expect(items[2]).toMatchObject({
      matchCode: 'GEN25934M',
      quantity: '5200.0000',
      unitPrice: '0.079200',
      totalAmount: '411.8400',
    });
    expect(items[3]).toMatchObject({
      descriptionRaw: '32+17X40 GR 80 BOLSAS PAPEL FUCSIA ASA PLANA',
      matchCode: 'GEN321740FUC',
      quantity: '3000.0000',
      unitPrice: '0.188700',
      totalAmount: '566.1000',
    });
  });

  it('keeps supplier reference as match code when it has an extra suffix', () => {
    const items = service.extractInvoice({
      supplierName: 'PLASTIVALLE',
      rawText: `
GEN241132BO
24+11X32 GR-100 BOLSA BLANCA ASA RETORCIDA
2,000
107,600
215,200
GEN451440BO
45+14X40 GR-100 BOLSA BLANCA ASA RETORCIDA
2,000
185,400
370,800
`,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      matchCode: 'GEN241132BO',
      quantity: '2000.0000',
      unitPrice: '0.107600',
      totalAmount: '215.2000',
    });
    expect(items[0].rawData.extractor).not.toMatchObject({
      alternateMatchCodes: expect.any(Array),
    });
    expect(items[1]).toMatchObject({
      matchCode: 'GEN451440BO',
      quantity: '2000.0000',
      unitPrice: '0.185400',
      totalAmount: '370.8000',
    });
    expect(items[1].rawData.extractor).not.toMatchObject({
      alternateMatchCodes: expect.any(Array),
    });
  });
});
