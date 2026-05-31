import { PriceUnit } from '@prisma/client';
import { InterpackExtractorService } from './interpack-extractor.service';

describe('InterpackExtractorService', () => {
  let service: InterpackExtractorService;

  beforeEach(() => {
    service = new InterpackExtractorService();
  });

  it('extracts modern bag invoice rows using the supplier reference as match code', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK EMBALAJES AL ANDALUS S.L.',
      rawText: `
INTERPACK EMBALAJES AL ANDALUS S.L.
03022 - BOLSA PAPEL BLANCO IMP 15+6*31
15631BI
25,00
15,800
395,00
"VICTORIA PASTELERIA"
06030 - BOLSA PAPEL MARRON IMP 22+7*36
22735MI
25,00
23,200
580,00
`,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      descriptionRaw: '03022 - BOLSA PAPEL BLANCO IMP 15+6*31',
      matchCode: '15631BI',
      reference: '15631BI',
      quantity: '25000.0000',
      unit: PriceUnit.UNIT,
      unitPrice: '0.015800',
      totalAmount: '395.0000',
    });
    expect(items[1]).toMatchObject({
      matchCode: '22735MI',
      reference: '22735MI',
      quantity: '25000.0000',
      unitPrice: '0.023200',
      totalAmount: '580.0000',
    });
    expect(items[1].rawData.extractor).toMatchObject({
      alternateMatchCodes: ['22736MI'],
    });
  });

  it('maps fixed antigrasa resmas to the manual business-rule tariff', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
RESMA ANTIGRASA 75*100 500H
RESMA2
20,00
44,000
880,00
ABONO ERROR PRECIO FACTURA
ABONO
1,00
-771,750
-771,75
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('maps the fixed antigrasa resma by invoice description even without RESMA2', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
RESMA ANTIGRASA 75*100 500H
20,00
44,000
880,00
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('maps the fixed antigrasa resma by inline invoice description', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: 'RESMA ANTIGRASA 75*100 500H 20,00 44,000 0,00 880,00',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('maps Interpack reference-only resma rows before the generic parser sees RESMA2', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
RESMA2
20,00
44,000
880,00
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('extracts Interpack OCR table rows where RESMA2 is the product cell', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawData: {
        ocr: {
          tables: [
            {
              page: 1,
              rows: [
                ['Codigo', 'Articulo', 'Cantidad', 'Precio', 'Dto', 'Total'],
                ['RESMA2', '20,00', '44,000', '0,00', '880,00'],
              ],
            },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
    expect(items[0].rawData.extractor).toMatchObject({
      name: 'interpack-invoice-table',
    });
  });

  it('extracts Interpack inline OCR text rows where RESMA2 carries the numeric columns', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: 'RESMA2 20,00 44,000 0,00 880,00',
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('extracts Interpack OCR line objects where RESMA2 carries the numeric columns', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawData: {
        ocr: {
          lines: [
            { text: 'Cabecera factura' },
            { text: 'RESMA2 20,00 44,000 0,00 880,00' },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('keeps only the mathematically valid fixed resma reading when OCR also emits bad fragments', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
RESMA ANTIGRASA 75*100 500H
RESMA2
44,000
880,00
RESMA ANTIGRASA 75*100 500H
RESMA2
20,00
44,000
880,00
`,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('drops orphan RESMA2 fragments when the complete fixed resma line is also present', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawData: {
        ocr: {
          lines: [
            { text: 'RESMA2 44,000' },
            { text: 'RESMA ANTIGRASA 75*100 500H' },
            { text: 'RESMA2' },
            { text: '20,00' },
            { text: '44,000' },
            { text: '880,00' },
          ],
        },
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 75*100 500H',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_75X100_500H',
      reference: 'RESMA2',
      quantity: '20.0000',
      unitPrice: '44.000000',
      totalAmount: '880.0000',
    });
  });

  it('extracts Interpack invoice rows with non-numeric references, cliches and antigrasa bag references', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
RESMA ANTIGRASA 63,5X86 CM 40GR 400H IMP.
RESMA ANT.IMP
20,00
34,300
686,00
CORTE 60X40
CLICHES
CLICHES
1,00
65,000
65,00
"IMP: ATELIER VIENA"
10+4*31 BOLSA PAPEL ANTIGRASA IMP.
10431AI
50,00
20,400
1.020,00
"EL MARQUES"
`,
    });

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      descriptionRaw: 'RESMA ANTIGRASA 63,5X86 CM 40GR 400H IMP. CORTE 60X40',
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_CORTE_40X60',
      reference: 'RESMAANTIMP',
      quantity: '20.0000',
      unitPrice: '34.300000',
      totalAmount: '686.0000',
    });
    expect(items[1]).toMatchObject({
      descriptionRaw: 'CLICHES',
      matchCode: 'CLICHES',
      reference: 'CLICHES',
      quantity: '1.0000',
      unitPrice: '65.000000',
      totalAmount: '65.0000',
    });
    expect(items[2]).toMatchObject({
      descriptionRaw: '10+4*31 BOLSA PAPEL ANTIGRASA IMP.',
      matchCode: '10431AI',
      reference: '10431AI',
      quantity: '50000.0000',
      unitPrice: '0.020400',
      totalAmount: '1020.0000',
    });
    expect(items[2].rawData.extractor).not.toMatchObject({
      alternateMatchCodes: expect.any(Array),
    });
  });

  it('extracts legacy resma rows and infers match codes from gramaje or cut size', () => {
    const items = service.extractInvoice({
      supplierName: 'INTERPACK',
      rawText: `
CODIGO DESCRIPCION CANTIDAD PRECIO DTO. IMPORTE
RESMA IMP.
RESMA 62X86 CM CELULOSA 19GR 400H IMP.
    10,000       19,000
      190,00
PAPEL ANTIGRA
P. ANTIGRASA IMP. 40GR 28X25 CM MILLAR
   32,000       14,000
     448,00
CLICHES
CLICHES
    1,000       65,000
       65,00
`,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      matchCode: 'INTERPACK_CELULOSA_19G',
      quantity: '10.0000',
      unitPrice: '19.000000',
      totalAmount: '190.0000',
    });
    expect(items[1]).toMatchObject({
      matchCode: 'INTERPACK_RESMA_ANTIGRASA_CORTE_25X28',
      quantity: '32000.0000',
      unitPrice: '0.014000',
      totalAmount: '448.0000',
    });
  });
});
